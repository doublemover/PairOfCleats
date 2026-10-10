import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { assertRuntimeEvidence, assertRuntimeProjection } from '../../../contracts/validators/runtime-evidence.js';
import { assertRuntimeFamily } from '../../../contracts/validators/runtime-evidence-family.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { createSemanticDiskAccount } from '../../build/artifacts/writers/semantic/partition.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { assertRuntimeImportAuthority } from './plan.js';
import { retainRuntimeRaw, hashRuntimeFile, runtimeByteHash, runtimeImportError, readRuntimeLines, assertRuntimeDiskReserve } from './raw-store.js';
import { OFFLINE_RUNTIME_PARSER, createAdapterCoverage, markRuntimeCoverage, runtimeEventLimit } from './adapters/shared.js';
import { adaptCpuProfile } from './adapters/cpu-profile.js';
import { adaptCodeLog } from './adapters/code-log.js';
import { writeRuntimeQueryIndex, openRuntimeQueryIndex, assertRuntimeIndexedRow } from './query-index.js';

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const pointerCharges = new WeakMap();
const jsonBytes = value => Buffer.from(canonicalSemanticJson(value) + '\n');
const readJson = async filename => {
  if ((await fs.stat(filename)).size > MAX_MANIFEST_BYTES) throw runtimeImportError('Runtime manifest exceeds allowance.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(filename)));
};
const assertCandidates = (capture, candidates) => {
  if (!Array.isArray(candidates) || candidates.length > capture.limits.maxEvents) throw runtimeImportError('Source candidate inventory exceeds allowance.');
  for (const row of candidates) {
    if (!row || Object.keys(row).some(key => !['sourceUnitId', 'sourceHash', 'targets'].includes(key))
      || !capture.sources.some(source => source.sourceUnitId === row.sourceUnitId && source.byteHash === row.sourceHash)
      || !Array.isArray(row.targets) || row.targets.length > capture.limits.maxEvents
      || row.targets.some(ref => Object.keys(ref).length !== 2 || !/^(sy1|sa1):[a-f0-9]{64}$/.test(ref.partitionId)
        || !Number.isSafeInteger(ref.localId) || ref.localId < 0)) throw runtimeImportError('Source join candidate is outside the capture snapshot.');
  }
};

/** Verify a complete standalone immutable family without loading evidence rows into a repository array. */
export const verifyRuntimeFamily = async ({ destination, pointer = null, maxBytes = Number.MAX_SAFE_INTEGER, signal = null }) => {
  const current = assertRuntimeFamily('pointer', pointer || await readJson(path.join(destination, 'current.json')));
  if (current.manifest.path !== 'generations/' + current.generationId + '/manifest.json') throw runtimeImportError('Runtime pointer generation/path mismatch.');
  const manifestPath = await resolveSemanticPartPath(destination, current.manifest.path);
  await hashRuntimeFile({ filename: manifestPath, expectedHash: current.manifest.hash,
    expectedBytes: current.manifest.byteLength, maxBytes: MAX_MANIFEST_BYTES, signal });
  const manifest = assertRuntimeFamily('manifest', await readJson(manifestPath));
  if (manifest.generationId !== current.generationId) throw runtimeImportError('Runtime family generation mismatch.');
  const root = path.dirname(manifestPath);
  const capturePath = await resolveSemanticPartPath(root, manifest.capture.path);
  await hashRuntimeFile({ filename: capturePath, expectedHash: manifest.capture.hash,
    expectedBytes: manifest.capture.byteLength, maxBytes: MAX_MANIFEST_BYTES, signal });
  const capture = assertRuntimeEvidence('capture', await readJson(capturePath));
  if (capture.completion === 'complete' && manifest.coverage.some(row => row.status !== 'complete')) {
    throw runtimeImportError('Incomplete runtime coverage cannot claim a complete capture projection.');
  }
  for (const raw of manifest.raw) {
    if (raw.path !== 'raw/' + raw.hash + '.bin' || !capture.rawArtifacts.some(row => row.artifactId === raw.artifactId
      && row.captureId === raw.captureId && row.hash === raw.hash && row.byteLength === raw.byteLength
      && row.storageRef === raw.path && row.pinned === raw.pinned && row.format === raw.format && row.formatVersion === raw.formatVersion)) {
      throw runtimeImportError('Runtime retained raw inventory mismatch.');
    }
    await hashRuntimeFile({ filename: await resolveSemanticPartPath(destination, raw.path), expectedHash: raw.hash,
      expectedBytes: raw.byteLength, maxBytes: capture.limits.maxBytes, signal });
  }
  if (capture.rawArtifacts.length !== manifest.raw.length) throw runtimeImportError('Missing retained raw artifact.');
  if (manifest.queryIndex.path !== 'query.sqlite') throw runtimeImportError('Runtime lookup index path mismatch.');
  const queryIndexPath = await resolveSemanticPartPath(root, manifest.queryIndex.path);
  await hashRuntimeFile({ filename: queryIndexPath, expectedHash: manifest.queryIndex.hash,
    expectedBytes: manifest.queryIndex.byteLength, maxBytes, signal });
  const evidencePath = await resolveSemanticPartPath(root, manifest.evidence.path);
  await hashRuntimeFile({ filename: evidencePath, expectedHash: manifest.evidence.hash,
    expectedBytes: manifest.evidence.byteLength, maxBytes, signal });
  const offsetsPath = await resolveSemanticPartPath(root, manifest.evidence.offsetsPath);
  await hashRuntimeFile({ filename: offsetsPath, expectedHash: manifest.evidence.offsetsHash,
    expectedBytes: manifest.evidence.count * 8, maxBytes, signal });
  const offsets = await fs.open(offsetsPath, 'r');
  let queryIndex = null;
  const ids = new Set(), offsetBuffer = Buffer.alloc(8);
  let count = 0;
  try {
    queryIndex = openRuntimeQueryIndex({ filename: queryIndexPath, manifest, capture });
    if (queryIndex.prepare('SELECT count(*) AS count FROM evidence').get().count !== manifest.evidence.count
      || queryIndex.prepare('SELECT 1 FROM source_refs r LEFT JOIN evidence e ON e.ordinal=r.ordinal WHERE e.ordinal IS NULL LIMIT 1').get()) throw runtimeImportError('Runtime lookup row/reference inventory mismatch.');
    const indexRow = queryIndex.prepare('SELECT * FROM evidence WHERE ordinal=?');
    const indexRefs = queryIndex.prepare('SELECT partition_id,local_id FROM source_refs WHERE ordinal=? ORDER BY partition_id,local_id');
    for await (const line of readRuntimeLines({ filename: evidencePath, maxLineBytes: MAX_MANIFEST_BYTES, signal })) {
      if (!line.terminated || line.oversized) throw runtimeImportError('Malformed published runtime row.');
      const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line.bytes));
      assertRuntimeProjection({ capture, evidence: [row] });
      if (ids.has(row.evidenceId) || count >= runtimeEventLimit(capture)) throw runtimeImportError('Duplicate or excess runtime observation.');
      ids.add(row.evidenceId);
      const indexed = indexRow.get(count);
      assertRuntimeIndexedRow(row, indexed);
      if (indexed.byte_length !== line.bytes.length + 1 || indexed.row_hash !== runtimeByteHash(Buffer.concat([line.bytes, Buffer.from('\n')]))) throw runtimeImportError('Runtime lookup row hash/range mismatch.');
      const expectedRefs = [...new Set(row.join.targets.map(ref => JSON.stringify([ref.partitionId, ref.localId])))].sort();
      const actualRefs = indexRefs.all(count).map(ref => JSON.stringify([ref.partition_id, ref.local_id])).sort();
      if (JSON.stringify(expectedRefs) !== JSON.stringify(actualRefs)) throw runtimeImportError('Runtime lookup source references mismatch.');
      if ((await offsets.read(offsetBuffer, 0, 8, count * 8)).bytesRead !== 8
        || offsetBuffer.readBigUInt64LE() !== BigInt(line.start)) throw runtimeImportError('Runtime offset table mismatch.');
      count += 1;
    }
  } finally { queryIndex?.close(); await offsets.close(); }
  if (count !== manifest.evidence.count) throw runtimeImportError('Runtime evidence inventory count mismatch.');
  const expected = semanticHash('pairofcleats.runtime.family.v1', { ...manifest, generationId: null });
  if (expected !== manifest.generationId) throw runtimeImportError('Runtime family canonical identity mismatch.');
  return { pointer: current, manifest, capture };
};

/** Explicit offline import only. The API has no collector, process, inspector, or execution hook. */
export const importRuntimeEvidence = async ({ destination, capture: suppliedCapture, authority,
  inputs, sourceCandidates = [], importOptions, diskAccount = null, signal = null }) => {
  if (!importOptions || Object.keys(importOptions).some(key => key !== 'maxDiskWorkingSetBytes')
    || !Number.isSafeInteger(importOptions.maxDiskWorkingSetBytes) || importOptions.maxDiskWorkingSetBytes < 0) {
    throw new TypeError('Explicit maxDiskWorkingSetBytes import allowance required.');
  }
  const capture = structuredClone(assertRuntimeEvidence('capture', suppliedCapture));
  if (!Array.isArray(inputs) || inputs.length !== capture.rawArtifacts.length || inputs.length > 128
    || capture.rawArtifacts.length > capture.limits.maxEvents) throw runtimeImportError('Exact bounded raw input inventory required.');
  assertRuntimeImportAuthority({ authority, capture, artifacts: capture.rawArtifacts });
  assertCandidates(capture, sourceCandidates);
  const inputMap = new Map();
  for (const input of inputs) {
    if (!input || Object.keys(input).some(key => !['artifactId', 'path'].includes(key))
      || typeof input.path !== 'string' || inputMap.has(input.artifactId)) throw runtimeImportError('Invalid or duplicate runtime input.');
    inputMap.set(input.artifactId, input.path);
  }
  if (capture.rawArtifacts.some(row => !inputMap.has(row.artifactId))) throw runtimeImportError('Missing authorized runtime input.');
  if (capture.rawArtifacts.reduce((sum, row) => sum + row.byteLength, 0) > capture.limits.maxBytes) throw runtimeImportError('Capture raw byte allowance exceeded.');
  throwIfAborted(signal);
  await fs.mkdir(destination, { recursive: true });
  await assertRuntimeDiskReserve({ destination, diskReserveBytes: capture.limits.diskReserveBytes });
  const sharedAccount = diskAccount || createSemanticDiskAccount(importOptions.maxDiskWorkingSetBytes);
  const importBudget = createSemanticDiskAccount(importOptions.maxDiskWorkingSetBytes);
  const account = {
    reserve(bytes) {
      importBudget.reserve(bytes);
      try { sharedAccount.reserve(bytes); } catch (error) { importBudget.release(bytes); throw error; }
    },
    release(bytes) { sharedAccount.release(bytes); importBudget.release(bytes); }
  };
  capture.parser = OFFLINE_RUNTIME_PARSER;
  for (let index = 0; index < capture.rawArtifacts.length; index += 1) {
    const artifact = capture.rawArtifacts[index];
    capture.rawArtifacts[index] = await retainRuntimeRaw({ destination, inputPath: inputMap.get(artifact.artifactId),
      artifact, maxBytes: capture.limits.maxBytes, diskAccount: account,
      diskReserveBytes: capture.limits.diskReserveBytes, signal });
  }
  const generations = path.join(destination, 'generations');
  await fs.mkdir(generations, { recursive: true });
  await resolveSemanticPartPath(destination, 'generations');
  const pending = await fs.mkdtemp(path.join(generations, '.pending-'));
  let reserved = 0, retained = false, published = false, promotedRoot = null;
  const reserve = async bytes => {
    await assertRuntimeDiskReserve({ destination, diskReserveBytes: capture.limits.diskReserveBytes, additionalBytes: bytes });
    account.reserve(bytes); reserved += bytes;
  };
  const writeMember = async (name, bytes) => {
    await reserve(bytes.length);
    const handle = await fs.open(path.join(pending, name), 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return { path: name, hash: runtimeByteHash(bytes), byteLength: bytes.length };
  };
  try {
    const evidence = await fs.open(path.join(pending, 'evidence.jsonl'), 'wx');
    let offsets = null;
    const evidenceHash = createHash('sha256'), offsetsHash = createHash('sha256');
    const offset = Buffer.alloc(8), ids = new Set(), scriptHashes = new Map(), scriptConflicts = new Set(), coverage = [];
    let count = 0, byteLength = 0;
    try {
      offsets = await fs.open(path.join(pending, 'evidence.offsets'), 'wx');
      // Saved script metadata is projected before profiles, independently of caller input order.
      const artifacts = [...capture.rawArtifacts].sort((a, b) => (a.format === 'pairofcleats-code-log' ? 0 : 1)
        - (b.format === 'pairofcleats-code-log' ? 0 : 1) || a.artifactId.localeCompare(b.artifactId));
      for (const artifact of artifacts) {
        throwIfAborted(signal);
        const state = createAdapterCoverage(artifact); coverage.push(state);
        const adapter = artifact.formatVersion === '1' && artifact.format === 'inspector-cpu-profile' ? adaptCpuProfile
          : artifact.formatVersion === '1' && artifact.format === 'pairofcleats-code-log' ? adaptCodeLog : null;
        if (!adapter) { markRuntimeCoverage(state, 'unsupported_raw_format_or_version', 0, 'unsupported'); continue; }
        const filename = await resolveSemanticPartPath(destination, artifact.storageRef);
        for await (const row of adapter({ filename, artifact, capture, sourceCandidates, scriptHashes, coverage: state, signal })) {
          throwIfAborted(signal);
          assertRuntimeProjection({ capture, evidence: [row] });
          if (count >= runtimeEventLimit(capture)) {
            state.observedRecords -= 1;
            markRuntimeCoverage(state, 'capture_projection_event_limit', 1); continue;
          }
          if (ids.has(row.evidenceId)) throw runtimeImportError('Duplicate normalized observation identity.');
          ids.add(row.evidenceId);
          if (row.kind === 'scriptMetadata' && row.data.contentHash) {
            const prior = scriptHashes.get(row.data.scriptId);
            if (prior && prior !== row.data.contentHash) { scriptHashes.delete(row.data.scriptId); scriptConflicts.add(row.data.scriptId); }
            if (!scriptConflicts.has(row.data.scriptId)) scriptHashes.set(row.data.scriptId, row.data.contentHash);
            else markRuntimeCoverage(state, 'ambiguous_script_content_hash');
          }
          const bytes = jsonBytes(row);
          if (bytes.length > MAX_MANIFEST_BYTES) throw runtimeImportError('Runtime observation exceeds row allowance.');
          offset.writeBigUInt64LE(BigInt(byteLength));
          await reserve(bytes.length + 8);
          await evidence.writeFile(bytes); await offsets.writeFile(offset);
          evidenceHash.update(bytes); offsetsHash.update(offset); byteLength += bytes.length; count += 1;
        }
      }
      await evidence.sync(); await offsets.sync();
    } finally { await evidence.close(); if (offsets) await offsets.close(); }
    if (coverage.some(row => row.status !== 'complete')) {
      if (capture.completion === 'complete') capture.completion = 'partial';
      capture.warnings = [...new Set([...capture.warnings, 'offline_projection_has_incomplete_coverage'])];
    }
    capture.coverage = [...new Set([...capture.coverage, ...coverage.map(row => row.artifactId + ':' + row.status)])];
    const captureMember = await writeMember('capture.json', jsonBytes(assertRuntimeEvidence('capture', capture)));
    const evidenceMember = { path: 'evidence.jsonl', hash: evidenceHash.digest('hex'), byteLength,
      count, offsetsPath: 'evidence.offsets', offsetsHash: offsetsHash.digest('hex') };
    const queryIndex = await writeRuntimeQueryIndex({ root: pending, evidence: evidenceMember, capture, reserve,
      release: bytes => { account.release(bytes); reserved -= bytes; }, signal });
    const family = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generationId: null,
      capture: captureMember, evidence: evidenceMember,
      raw: capture.rawArtifacts.map(row => ({ artifactId: row.artifactId, captureId: row.captureId,
        path: row.storageRef, hash: row.hash, byteLength: row.byteLength, format: row.format, formatVersion: row.formatVersion, pinned: row.pinned })), coverage, queryIndex };
    family.generationId = semanticHash('pairofcleats.runtime.family.v1', family);
    assertRuntimeFamily('manifest', family);
    const manifest = await writeMember('manifest.json', jsonBytes(family));
    const pointer = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generationId: family.generationId,
      manifest: { ...manifest, path: 'generations/' + family.generationId + '/manifest.json' } };
    const final = path.join(generations, family.generationId);
    try { await fs.rename(pending, final); retained = true; promotedRoot = final; }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      await verifyRuntimeFamily({ destination, pointer, maxBytes: importOptions.maxDiskWorkingSetBytes, signal });
    }
    await verifyRuntimeFamily({ destination, pointer, maxBytes: importOptions.maxDiskWorkingSetBytes, signal });
    await assertRuntimeDiskReserve({ destination, diskReserveBytes: capture.limits.diskReserveBytes });
    throwIfAborted(signal);
    const pointerBytes = jsonBytes(assertRuntimeFamily('pointer', pointer));
    const currentPath = path.join(destination, 'current.json');
    try {
      if ((await fs.readFile(currentPath)).equals(pointerBytes)) {
        published = true;
        return { executionAuthorized: false, pointer, capture, coverage, recordCount: count };
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await assertRuntimeDiskReserve({ destination, diskReserveBytes: capture.limits.diskReserveBytes, additionalBytes: pointerBytes.length });
    account.reserve(pointerBytes.length);
    let pointerPublished = false;
    const pointerTemporary = path.join(destination, '.current-' + family.generationId + '-' + path.basename(pending) + '.json');
    try {
      const handle = await fs.open(pointerTemporary, 'wx');
      try { await handle.writeFile(pointerBytes); await handle.sync(); } finally { await handle.close(); }
      throwIfAborted(signal);
      await fs.rename(pointerTemporary, currentPath);
      pointerPublished = true; published = true;
      let charges = pointerCharges.get(sharedAccount);
      if (!charges) { charges = new Map(); pointerCharges.set(sharedAccount, charges); }
      const previous = charges.get(path.resolve(currentPath)) || 0;
      sharedAccount.release(previous);
      charges.set(path.resolve(currentPath), pointerBytes.length);
    } finally {
      await fs.rm(pointerTemporary, { force: true });
      if (!pointerPublished) account.release(pointerBytes.length);
    }
    return { executionAuthorized: false, pointer, capture, coverage, recordCount: count };
  } finally {
    await fs.rm(pending, { recursive: true, force: true });
    if (promotedRoot && !published) await fs.rm(promotedRoot, { recursive: true, force: true });
    if (!retained || !published) account.release(reserved);
  }
};
