import { readExactAt } from '../../../shared/io/read-exact.js';
import { readRuntimeMemberJson, readRuntimeMemberBytes, openVerifiedRuntimeMember } from './verified-reads.js';
import { withRuntimeDestinationWriter } from './ownership.js';
import { closeRuntimeResources } from './close-resources.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRuntimeClaims } from '../../../contracts/validators/runtime-claims.js';
import { assertRuntimeEvidence } from '../../../contracts/validators/runtime-evidence.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { openRuntimeQueryFamily } from './query-store.js';
import { runtimeByteHash, hashRuntimeFile, runtimeImportError, assertRuntimeDiskReserve } from './raw-store.js';
import { runtimeCaptureCompatibility } from './compatibility.js';
import { performance } from 'node:perf_hooks';
import { RUNTIME_QUERY_LIMITS_SCHEMA } from '../../../contracts/schemas/runtime-query.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { createRuntimeClaimPublicationState } from '../../../shared/runtime-claim-publication.js';
import { createRuntimeClaimVerification } from '../../../shared/runtime-claim-verification.js';

const domain = 'pairofcleats.runtime.claim-family.v1';
const fail = message => { throw runtimeImportError(message, 'ERR_RUNTIME_CLAIMS_INTEGRITY'); };
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
const budgets = new WeakMap();

export const runtimeClaimsBudget = (limits, signal = null, inherited = null) => {
  const maxMs = limits?.maxMs;
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > RUNTIME_QUERY_LIMITS_SCHEMA.properties.maxMs.maximum) {
    throw new TypeError('Invalid runtime claims time allowance.');
  }
  if (inherited !== null) {
    const owner = budgets.get(inherited);
    if (!owner || owner.maxMs !== maxMs || (signal && signal !== owner.callerSignal && signal !== inherited.signal)) {
      throw new TypeError('Runtime claims require the original operation budget.');
    }
    inherited(); return inherited;
  }
  throwIfAborted(signal);
  const deadlineAt = performance.now() + maxMs;
  const deadline = AbortSignal.timeout(maxMs);
  const check = () => {
    throwIfAborted(signal);
    if (deadline.aborted || performance.now() >= deadlineAt) throw runtimeImportError('Saved comparison exceeded its allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
  };
  Object.defineProperties(check, {
    signal: { value: signal ? AbortSignal.any([signal, deadline]) : deadline },
    deadlineAt: { value: deadlineAt },
    remainingMs: { value: () => Math.max(0, Math.ceil(deadlineAt - performance.now())) }
  });
  budgets.set(check, { maxMs, callerSignal: signal, publicationState: null });
  Object.freeze(check);
  return check;
};

/** Deadline classification retains the original resource failure and any
 * producer-attested publication identity. The receipt grants no mutation rights. */
export const runtimeClaimsFailure = (error, check) => {
  let failure = error;
  try { check(); }
  catch (budgetError) { failure = addStorageFailureContext(budgetError, {}, error, { secondaryPresent: true }); }
  return retainRuntimeClaimFailure(failure, check);
};
export const retainRuntimeClaimFailure = (error, check) => budgets.get(check)?.publicationState?.retainFailure(error) || error;
const bounded = async (operation, check) => {
  try { return await operation(); } catch (error) { throw runtimeClaimsFailure(error, check); }
};

const writeClaimMember = async (filename, bytes, check) => {
  check();
  const handle = await fs.open(filename, 'wx');
  let failed = false, failure;
  try {
    check(); await handle.writeFile(bytes);
    check(); await handle.sync(); check();
  } catch (error) { failed = true; failure = error; throw error; }
  finally { await closeRuntimeResources([handle], failure, { hasOperationError: failed }); }
};

/** Bounded authoritative citations. Observation IDs must identify one pinned capture, never an inferred claim. */
const verifyCitations = async ({ destination, inputs, citations, repositoryNamespace, generation, limits, signal, check,
  verification = createRuntimeClaimVerification({ maxHydratedBytes: limits.maxBytes }, { maxMs: limits.maxMs }) }) => {
  const records = new Map(), rawChecked = new Set();
  if (new Set(inputs.map(row => row.generationId)).size !== inputs.length
    || new Set(inputs.map(row => row.captureId)).size !== inputs.length) fail('Claim input capture identities must be distinct.');
  let diskReserveBytes = 0, primaryCapture = null;
  try {
    for (const pin of inputs) {
      check();
      verification.admit('familyOpens', 1); verification.metrics.familyOpens++;
      const family = await bounded(() => openRuntimeQueryFamily({ destination, generationId: pin.generationId,
        signal: check.signal, metrics: verification.metrics }), check);
      let citationError = null, citationErrorPresent = false;
      try {
        if (family.manifestHash !== pin.manifestHash || family.capture.captureId !== pin.captureId
          || family.capture.repositoryNamespace !== repositoryNamespace || !same(family.capture.generation, generation)) fail('Claim input family scope or manifest changed.');
        diskReserveBytes = Math.max(diskReserveBytes, family.capture.limits.diskReserveBytes);
        if (primaryCapture && runtimeCaptureCompatibility(primaryCapture, family.capture).length) fail('Derived claim inputs are incompatible.');
        primaryCapture ||= family.capture;
        for (const citation of citations.filter(row => row.generationId === pin.generationId)) {
          check();
          if (citation.captureId !== pin.captureId || records.has(citation.evidenceId)) fail('Ambiguous claim evidence owner.');
          const entry = family.db.prepare('SELECT * FROM evidence WHERE evidence_id=?').get(citation.evidenceId);
          if (!entry || entry.row_hash !== citation.rowHash) fail('Claim citation no longer matches its retained observation.');
          if (!Number.isSafeInteger(entry.byte_length) || entry.byte_length < 1 || entry.byte_length > 16 * 1024 * 1024) fail('Claim citation row extent is invalid.');
          verification.admit('citationRows', 1); verification.metrics.citationRows++;
          verification.admit('hydratedBytes', entry.byte_length);
          const remaining = verification.limits.maxHydratedBytes - verification.metrics.hydratedBytes;
          const row = await bounded(() => family.hydrate(entry, remaining), check);
          if (!row) verification.refuse('hydratedBytes', verification.metrics.hydratedBytes,
            entry.byte_length, verification.limits.maxHydratedBytes);
          if (row.evidenceClass !== 'observed') fail('Claim support must be a bounded direct observation.');
          for (const ref of row.rawRefs) {
            const raw = family.capture.rawArtifacts.find(item => item.artifactId === ref.artifactId && item.hash === ref.hash);
            if (!raw?.retained || !raw.storageRef) fail('Claim raw support is not retained.');
            if (raw.storageRef !== 'raw/' + raw.hash + '.bin') fail('Claim raw storage identity differs from its content hash.');
            if (!rawChecked.has(raw.hash)) {
              verification.admit('rawVerificationBytes', raw.byteLength);
              const filename = await resolveSemanticPartPath(destination, raw.storageRef);
              await bounded(() => hashRuntimeFile({ filename, expectedHash: raw.hash, expectedBytes: raw.byteLength,
                maxBytes: Math.min(family.capture.limits.maxBytes, 64 * 1024 * 1024), signal: check.signal,
                metrics: verification.metrics }), check);
              rawChecked.add(raw.hash); check();
            }
          }
          records.set(row.evidenceId, row);
        }
      } catch (error) { citationErrorPresent = true; citationError = error; throw error; }
      finally { await closeRuntimeResources([family], citationError, { hasOperationError: citationErrorPresent }); }
    }
    if (records.size !== citations.length) fail('Claim citation points outside the pinned family inventory.');
    verification.markVerified();
    return { records, diskReserveBytes };
  } catch (error) { throw verification.retainFailure(error); }
};

const validateClaims = (claims, records) => {
  const ids = new Set();
  for (const claim of claims) {
    assertRuntimeEvidence('evidence', claim);
    if (claim.kind !== 'derivedClaim' || ids.has(claim.evidenceId) || records.has(claim.evidenceId)) fail('Invalid derived claim identity.');
    ids.add(claim.evidenceId);
    const support = claim.data.supportingEvidenceIds, contradiction = claim.data.contradictingEvidenceIds;
    if (!support.length || new Set([...support, ...contradiction]).size !== support.length + contradiction.length) fail('Claim needs distinct supporting/contradicting observations.');
    const cited = [...support, ...contradiction].map(id => records.get(id));
    if (cited.some(row => !row)) fail('Claim cites an unavailable observation.');
    const primary = cited.find(row => row.captureId === claim.captureId);
    if (!primary || !same(primary.scope, claim.scope) || !same(primary.clock, claim.clock)
      || !same(primary.workload, claim.workload) || !same(primary.join, claim.join)) fail('Claim primary scope/source authority differs from its support.');
    const authoritativeRaw = cited.flatMap(row => row.rawRefs);
    if (!claim.rawRefs.length || claim.rawRefs.some(ref => !authoritativeRaw.some(raw => same(raw, ref)))) fail('Claim raw citation is outside retained supporting observations.');
  }
};

/** Separate immutable derived family. Publishing never changes direct evidence or source index pointers. */
const persistRuntimeDerivedClaimsOwned = async ({ destination, repositoryNamespace, generation, inputs, citations, claims,
  limits, signal = null, diskAccount, check, publicationState }) => {
  check();
  assertRuntimeClaims('request', { schemaVersion: 1, repositoryNamespace, generation, claimGeneration: '0'.repeat(64), limits, cursor: null });
  if (!claims.length || claims.length > 64 || citations.length > Math.min(128, limits.maxRecords)) fail('Claim inventory exceeds allowance.');
  assertRuntimeClaims('manifest', { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    repositoryNamespace, generation, claimGeneration: '0'.repeat(64), inputs, citations, rows: [], evidenceHash: '0'.repeat(64), offsetsHash: '0'.repeat(64), byteLength: 0 });
  const verified = await verifyCitations({ destination, repositoryNamespace, generation, inputs, citations, limits, signal, check });
  validateClaims(claims, verified.records);
  const chunks = [], rows = []; let byteLength = 0;
  for (const claim of claims) {
    const bytes = Buffer.from(canonicalSemanticJson(claim) + '\n');
    rows.push({ evidenceId: claim.evidenceId, hash: runtimeByteHash(bytes), start: byteLength, byteLength: bytes.length });
    byteLength += bytes.length; if (byteLength > limits.maxBytes) fail('Derived output exceeds byte allowance.'); chunks.push(bytes);
  }
  const evidence = Buffer.concat(chunks);
  const offsets = Buffer.alloc(rows.length * 8);
  rows.forEach((row, index) => offsets.writeBigUInt64LE(BigInt(row.start), index * 8));
  const manifest = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, repositoryNamespace, generation,
    claimGeneration: null, inputs, citations, rows, evidenceHash: runtimeByteHash(evidence), offsetsHash: runtimeByteHash(offsets), byteLength };
  manifest.claimGeneration = semanticHash(domain, manifest);
  assertRuntimeClaims('manifest', manifest);
  const manifestBytes = Buffer.from(canonicalSemanticJson(manifest));
  Object.assign(publicationState, { claimGeneration: manifest.claimGeneration, manifestHash: runtimeByteHash(manifestBytes),
    familyState: 'not-published', pointerState: 'not-started' });
  if (manifestBytes.length + byteLength + offsets.length > limits.maxBytes) fail('Derived family exceeds byte allowance.');
  check(); await fs.mkdir(path.join(destination, 'claims'), { recursive: true }); check();
  const root = await resolveSemanticPartPath(destination, 'claims');
  await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: manifestBytes.length + byteLength + offsets.length });
  check();
  const reservation = manifestBytes.length + evidence.length + offsets.length + 1024;
  diskAccount.reserve(reservation);
  let retained = false;
  let pending = null;
  const final = path.join(root, manifest.claimGeneration);
  let pointerTemporary = null;
  let operationFailed = false, operationError;
  try {
    check(); pending = await fs.mkdtemp(path.join(root, '.pending-')); check();
    pointerTemporary = path.join(root, '.current-' + path.basename(pending));
    for (const [name, bytes] of [['claims.jsonl', evidence], ['claims.offsets', offsets], ['manifest.json', manifestBytes]]) {
      await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: bytes.length });
      await writeClaimMember(path.join(pending, name), bytes, check);
    }
    check();
    await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: 512 });
    check(); publicationState.familyState = 'promotion-unconfirmed'; retained = true;
    try { await fs.rename(pending, final); retained = true; publicationState.familyState = 'promoted'; }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      check();
      const old = (await readRuntimeMemberBytes({ root, relativePath: manifest.claimGeneration + '/manifest.json',
        maxBytes: limits.maxBytes, signal })).buffer;
      if (!old.equals(manifestBytes)) fail('Existing immutable claim family differs.');
      await hashRuntimeFile({ filename: await resolveSemanticPartPath(root, manifest.claimGeneration + '/claims.jsonl'),
        expectedHash: manifest.evidenceHash, expectedBytes: byteLength, maxBytes: limits.maxBytes, signal });
      await hashRuntimeFile({ filename: await resolveSemanticPartPath(root, manifest.claimGeneration + '/claims.offsets'),
        expectedHash: manifest.offsetsHash, expectedBytes: offsets.length, maxBytes: limits.maxBytes, signal });
      publicationState.familyState = 'reused'; retained = false;
    }
    check();
    await writeClaimMember(pointerTemporary, canonicalSemanticJson({ schemaVersion: 1, claimGeneration: manifest.claimGeneration,
      manifestHash: runtimeByteHash(manifestBytes) }), check);
    check(); publicationState.pointerState = 'commit-unconfirmed';
    await fs.rename(pointerTemporary, path.join(root, 'current.json'));
    publicationState.pointerState = 'committed'; check();
    return manifest.claimGeneration;
  } catch (error) { operationFailed = true; operationError = error; throw error;
  } finally {
    try {
      await closeRuntimeResources([
        pending && { close: () => fs.rm(pending, { recursive: true, force: true }) },
        pointerTemporary && { close: () => fs.rm(pointerTemporary, { force: true }) }
      ]);
      if (!retained) diskAccount.release(reservation);
    } catch (error) {
      throw operationFailed ? addStorageFailureContext(operationError, {}, error, { secondaryPresent: true }) : error;
    }
    // A complete content-addressed family may already be reused by another publisher or pinned reader.
    // Keep it immutable even if this convenience-pointer update fails; only staging is owned here.
  }
};

const queryClaims = async ({ destination, request, signal = null, verification }) => {
  assertRuntimeClaims('request', request);
  const check = runtimeClaimsBudget(request.limits, signal); check();
  const root = await resolveSemanticPartPath(destination, 'claims/' + request.claimGeneration);
  const manifest = assertRuntimeClaims('manifest', (await readRuntimeMemberJson({ root,
    relativePath: 'manifest.json', maxBytes: 1048576, signal: check.signal, metrics: verification.claimMetrics })).value);
  if (manifest.claimGeneration !== request.claimGeneration || semanticHash(domain, { ...manifest, claimGeneration: null }) !== request.claimGeneration) fail('Claim family hash mismatch.');
  if (manifest.repositoryNamespace !== request.repositoryNamespace || !same(manifest.generation, request.generation)) throw runtimeImportError('Derived family scope mismatch.', 'ERR_RUNTIME_QUERY_SCOPE');
  const queryId = semanticHash('pairofcleats.runtime.claim-query.v1', { ...request, cursor: null });
  let ordinal = 0;
  if (request.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(request.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (Object.keys(cursor).sort().join(',') !== 'checksum,ordinal,queryId'
        || cursor.queryId !== queryId || !Number.isInteger(cursor.ordinal) || cursor.ordinal < 0 || cursor.ordinal >= manifest.rows.length
        || cursor.checksum !== semanticHash('pairofcleats.runtime.claim-cursor.v1', { queryId, ordinal: cursor.ordinal })) throw new Error();
      ordinal = cursor.ordinal;
    } catch { throw runtimeImportError('Claim cursor does not match the pinned request.', 'ERR_RUNTIME_QUERY_CURSOR'); }
  }
  const verified = await verifyCitations({ ...request, destination, inputs: manifest.inputs, citations: manifest.citations, signal, check, verification });
  const offsets = (await bounded(() => readRuntimeMemberBytes({ root, relativePath: 'claims.offsets',
    expectedHash: manifest.offsetsHash, expectedBytes: manifest.rows.length * 8, maxBytes: 512, signal: check.signal,
    metrics: verification.claimMetrics }), check)).buffer;
  let expectedStart = 0;
  for (let index = 0; index < manifest.rows.length; index++) {
    const row = manifest.rows[index];
    if (row.start !== expectedStart || offsets.readBigUInt64LE(index * 8) !== BigInt(row.start)) fail('Claim offsets or row inventory mismatch.');
    expectedStart += row.byteLength;
  }
  if (expectedStart !== manifest.byteLength) fail('Claim row inventory length mismatch.');
  const handle = await bounded(() => openVerifiedRuntimeMember({ root, relativePath: 'claims.jsonl',
      expectedHash: manifest.evidenceHash, expectedBytes: manifest.byteLength, maxBytes: 1048576, signal: check.signal,
      metrics: verification.claimMetrics }), check), claims = [];
  let outputBytes = 1024 + Buffer.byteLength(JSON.stringify(manifest.inputs));
  let rowFailure, rowFailed = false;
  try {
    for (; ordinal < manifest.rows.length && claims.length < request.limits.maxRecords; ordinal++) {
      check(); const row = manifest.rows[ordinal];
      if (row.start + row.byteLength > manifest.byteLength) fail('Claim row bounds mismatch.');
      if (outputBytes + row.byteLength > request.limits.maxBytes) {
        if (!claims.length) verification.refuse('responseBytes', outputBytes, row.byteLength, request.limits.maxBytes);
        break;
      }
      const bytes = Buffer.alloc(row.byteLength);
      const read = await readExactAt(handle, bytes, 0, bytes.length, row.start, { signal: check.signal });
      verification.metrics.claimRowBytes += read.bytesRead;
      if (read.bytesRead !== bytes.length || runtimeByteHash(bytes) !== row.hash) fail('Claim row integrity mismatch.');
      const claim = JSON.parse(bytes.toString('utf8'));
      if (claim.evidenceId !== row.evidenceId) fail('Claim row identity mismatch.');
      validateClaims([claim], verified.records); claims.push(claim); outputBytes += row.byteLength;
    }
  } catch (error) { rowFailed = true; rowFailure = error; throw error;
  } finally { await closeRuntimeResources([handle], rowFailure, { hasOperationError: rowFailed }); }
  check();
  const payload = { queryId, ordinal };
  const nextCursor = ordinal < manifest.rows.length ? Buffer.from(canonicalSemanticJson({ ...payload,
    checksum: semanticHash('pairofcleats.runtime.claim-cursor.v1', payload) })).toString('base64url') : null;
  const result = { schemaVersion: 1, executionAuthorized: false, repositoryNamespace: request.repositoryNamespace,
    generation: request.generation, claimGeneration: request.claimGeneration, inputs: manifest.inputs, claims,
    integrity: 'claims-and-cited-observations-verified', nextCursor, verification: verification.snapshot() };
  for (let pass = 0; pass < 4; pass++) result.verification.cost.responseBytes = Buffer.byteLength(JSON.stringify(result));
  verification.metrics.responseBytes = result.verification.cost.responseBytes;
  if (verification.metrics.responseBytes > request.limits.maxBytes) verification.refuse('responseBytes', 0,
    verification.metrics.responseBytes, request.limits.maxBytes);
  check();
  return assertRuntimeClaims('result', result);
};
export const queryRuntimeDerivedClaims = async options => {
  assertRuntimeClaims('request', options.request);
  const verification = createRuntimeClaimVerification(options.verificationLimits, { maxMs: options.request.limits.maxMs });
  try { return await queryClaims({ ...options, verification }); }
  catch (error) {
    const failure = error.code === 'ENOENT'
      ? addStorageFailureContext(runtimeImportError('Pinned derived claim family or retained support is unavailable.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE'), {}, error, { secondaryPresent: true }) : error;
    throw verification.retainFailure(failure);
  }
};

/** Derived claims share destination ownership and the explicitly admitted total cap. */
export const persistRuntimeDerivedClaims = async input => {
  assertRuntimeClaims('request', { schemaVersion: 1, repositoryNamespace: input.repositoryNamespace, generation: input.generation,
    claimGeneration: '0'.repeat(64), limits: input.limits, cursor: null });
  const options = { ...input, limits: { ...input.limits } };
  assertRuntimeClaims('request', { schemaVersion: 1, repositoryNamespace: options.repositoryNamespace, generation: options.generation,
    claimGeneration: '0'.repeat(64), limits: options.limits, cursor: null });
  const check = runtimeClaimsBudget(options.limits, options.signal, options.budget ?? null);
  const publication = createRuntimeClaimPublicationState();
  budgets.get(check).publicationState = publication;
  try {
    const result = await withRuntimeDestinationWriter({ destination: options.destination, maxDiskWorkingSetBytes: null,
      diskAccount: options.diskAccount, signal: check.signal, checkAdmission: check, remainingMs: check.remainingMs }, ({ destination, account }) =>
      persistRuntimeDerivedClaimsOwned({ ...options, destination, diskAccount: account, signal: check.signal, check, publicationState: publication.state }));
    check(); return result;
  } catch (error) { throw runtimeClaimsFailure(error, check); }
};
