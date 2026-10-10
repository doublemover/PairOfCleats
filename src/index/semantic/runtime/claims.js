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

const domain = 'pairofcleats.runtime.claim-family.v1';
const fail = message => { throw runtimeImportError(message, 'ERR_RUNTIME_CLAIMS_INTEGRITY'); };
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
export const runtimeClaimsBudget = (limits, signal) => {
  const started = Date.now();
  const deadline = AbortSignal.timeout(limits.maxMs);
  const check = () => {
    throwIfAborted(signal);
    if (deadline.aborted || Date.now() - started > limits.maxMs) throw runtimeImportError('Saved comparison exceeded its allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
  };
  check.signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  return check;
};
const bounded = async (operation, check) => {
  try { return await operation(); } catch (error) { check(); throw error; }
};

/** Bounded authoritative citations. Observation IDs must identify one pinned capture, never an inferred claim. */
const verifyCitations = async ({ destination, inputs, citations, repositoryNamespace, generation, limits, signal, check }) => {
  const records = new Map(), rawChecked = new Set();
  if (new Set(inputs.map(row => row.generationId)).size !== inputs.length
    || new Set(inputs.map(row => row.captureId)).size !== inputs.length) fail('Claim input capture identities must be distinct.');
  let diskReserveBytes = 0, bytes = 0, primaryCapture = null;
  for (const pin of inputs) {
    check();
    const family = await bounded(() => openRuntimeQueryFamily({ destination, generationId: pin.generationId, signal: check.signal }), check);
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
        const row = await bounded(() => family.hydrate(entry, limits.maxBytes - bytes), check);
        if (!row || row.evidenceClass !== 'observed') fail('Claim support must be a bounded direct observation.');
        bytes += entry.byte_length;
        for (const ref of row.rawRefs) {
          const raw = family.capture.rawArtifacts.find(item => item.artifactId === ref.artifactId && item.hash === ref.hash);
          if (!raw?.retained || !raw.storageRef) fail('Claim raw support is not retained.');
          if (raw.storageRef !== 'raw/' + raw.hash + '.bin') fail('Claim raw storage identity differs from its content hash.');
          if (!rawChecked.has(raw.hash)) {
            const filename = await resolveSemanticPartPath(destination, raw.storageRef);
            await bounded(() => hashRuntimeFile({ filename, expectedHash: raw.hash, expectedBytes: raw.byteLength,
              maxBytes: Math.min(family.capture.limits.maxBytes, 64 * 1024 * 1024), signal: check.signal }), check);
            rawChecked.add(raw.hash); check();
          }
        }
        records.set(row.evidenceId, row);
      }
    } finally { await family.close(); }
  }
  if (records.size !== citations.length) fail('Claim citation points outside the pinned family inventory.');
  return { records, diskReserveBytes };
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
export const persistRuntimeDerivedClaims = async ({ destination, repositoryNamespace, generation, inputs, citations, claims,
  limits, signal = null }) => {
  const check = runtimeClaimsBudget(limits, signal); check();
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
  if (manifestBytes.length + byteLength + offsets.length > limits.maxBytes) fail('Derived family exceeds byte allowance.');
  await fs.mkdir(path.join(destination, 'claims'), { recursive: true });
  const root = await resolveSemanticPartPath(destination, 'claims');
  await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: manifestBytes.length + byteLength + offsets.length });
  const pending = await fs.mkdtemp(path.join(root, '.pending-'));
  const final = path.join(root, manifest.claimGeneration);
  const pointerTemporary = path.join(root, '.current-' + path.basename(pending));
  try {
    for (const [name, bytes] of [['claims.jsonl', evidence], ['claims.offsets', offsets], ['manifest.json', manifestBytes]]) {
      await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: bytes.length });
      check(); const handle = await fs.open(path.join(pending, name), 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    }
    check();
    await assertRuntimeDiskReserve({ destination, diskReserveBytes: verified.diskReserveBytes, additionalBytes: 512 });
    try { await fs.rename(pending, final); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      const old = await fs.readFile(await resolveSemanticPartPath(root, manifest.claimGeneration + '/manifest.json'));
      if (!old.equals(manifestBytes)) fail('Existing immutable claim family differs.');
      await hashRuntimeFile({ filename: await resolveSemanticPartPath(root, manifest.claimGeneration + '/claims.jsonl'),
        expectedHash: manifest.evidenceHash, expectedBytes: byteLength, maxBytes: limits.maxBytes, signal });
      await hashRuntimeFile({ filename: await resolveSemanticPartPath(root, manifest.claimGeneration + '/claims.offsets'),
        expectedHash: manifest.offsetsHash, expectedBytes: offsets.length, maxBytes: limits.maxBytes, signal });
    }
    check();
    const pointer = await fs.open(pointerTemporary, 'wx');
    try { await pointer.writeFile(canonicalSemanticJson({ schemaVersion: 1, claimGeneration: manifest.claimGeneration,
      manifestHash: runtimeByteHash(manifestBytes) })); await pointer.sync(); } finally { await pointer.close(); }
    check(); await fs.rename(pointerTemporary, path.join(root, 'current.json'));
    return manifest.claimGeneration;
  } finally {
    await fs.rm(pending, { recursive: true, force: true }); await fs.rm(pointerTemporary, { force: true });
    // A complete content-addressed family may already be reused by another publisher or pinned reader.
    // Keep it immutable even if this convenience-pointer update fails; only staging is owned here.
  }
};

const queryClaims = async ({ destination, request, signal = null }) => {
  assertRuntimeClaims('request', request);
  const check = runtimeClaimsBudget(request.limits, signal); check();
  const root = await resolveSemanticPartPath(destination, 'claims/' + request.claimGeneration);
  const filename = await resolveSemanticPartPath(root, 'manifest.json');
  if ((await fs.stat(filename)).size > 1048576) fail('Claim manifest exceeds allowance.');
  const manifest = assertRuntimeClaims('manifest', JSON.parse(await fs.readFile(filename, 'utf8')));
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
  const verified = await verifyCitations({ ...request, destination, inputs: manifest.inputs, citations: manifest.citations, signal, check });
  const evidencePath = await resolveSemanticPartPath(root, 'claims.jsonl');
  await bounded(() => hashRuntimeFile({ filename: evidencePath, expectedHash: manifest.evidenceHash, expectedBytes: manifest.byteLength, maxBytes: 1048576, signal: check.signal }), check);
  const offsetsPath = await resolveSemanticPartPath(root, 'claims.offsets');
  await bounded(() => hashRuntimeFile({ filename: offsetsPath, expectedHash: manifest.offsetsHash, expectedBytes: manifest.rows.length * 8, maxBytes: 512, signal: check.signal }), check);
  const offsets = await fs.readFile(offsetsPath);
  let expectedStart = 0;
  for (let index = 0; index < manifest.rows.length; index++) {
    const row = manifest.rows[index];
    if (row.start !== expectedStart || offsets.readBigUInt64LE(index * 8) !== BigInt(row.start)) fail('Claim offsets or row inventory mismatch.');
    expectedStart += row.byteLength;
  }
  if (expectedStart !== manifest.byteLength) fail('Claim row inventory length mismatch.');
  const handle = await fs.open(evidencePath, 'r'), claims = [];
  let outputBytes = 1024 + Buffer.byteLength(JSON.stringify(manifest.inputs));
  try {
    for (; ordinal < manifest.rows.length && claims.length < request.limits.maxRecords; ordinal++) {
      check(); const row = manifest.rows[ordinal];
      if (row.start + row.byteLength > manifest.byteLength) fail('Claim row bounds mismatch.');
      if (outputBytes + row.byteLength > request.limits.maxBytes) {
        if (!claims.length) throw runtimeImportError('Claim row exceeds response allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
        break;
      }
      const bytes = Buffer.alloc(row.byteLength);
      if ((await handle.read(bytes, 0, bytes.length, row.start)).bytesRead !== bytes.length || runtimeByteHash(bytes) !== row.hash) fail('Claim row integrity mismatch.');
      const claim = JSON.parse(bytes.toString('utf8'));
      if (claim.evidenceId !== row.evidenceId) fail('Claim row identity mismatch.');
      validateClaims([claim], verified.records); claims.push(claim); outputBytes += row.byteLength;
    }
  } finally { await handle.close(); }
  check();
  const payload = { queryId, ordinal };
  const nextCursor = ordinal < manifest.rows.length ? Buffer.from(canonicalSemanticJson({ ...payload,
    checksum: semanticHash('pairofcleats.runtime.claim-cursor.v1', payload) })).toString('base64url') : null;
  const result = { schemaVersion: 1, executionAuthorized: false, repositoryNamespace: request.repositoryNamespace,
    generation: request.generation, claimGeneration: request.claimGeneration, inputs: manifest.inputs, claims,
    integrity: 'claims-and-cited-observations-verified', nextCursor };
  if (Buffer.byteLength(JSON.stringify(result)) > request.limits.maxBytes) throw runtimeImportError('Claim result exceeds response allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
  return assertRuntimeClaims('result', result);
};
export const queryRuntimeDerivedClaims = async options => {
  try { return await queryClaims(options); }
  catch (error) {
    if (error.code === 'ENOENT') throw runtimeImportError('Pinned derived claim family or retained support is unavailable.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE');
    throw error;
  }
};
