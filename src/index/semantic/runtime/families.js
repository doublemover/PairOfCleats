import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRuntimeFamily } from '../../../contracts/validators/runtime-evidence-family.js';
import { assertRuntimeEvidence } from '../../../contracts/validators/runtime-evidence.js';
import { assertRuntimeQuery } from '../../../contracts/validators/runtime-query.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { semanticHash, canonicalSemanticJson } from '../identity.js';
import { hashRuntimeFile, runtimeByteHash, runtimeImportError } from './raw-store.js';

/** Bounded discovery keeps only one page of identities; queries must explicitly pin returned generations. */
export const listRuntimeFamilies = async ({ destination, limit = 32, maxScan = 4096, maxMs = 1000, maxBytes = 65536, cursor = null, signal = null }) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(maxScan) || maxScan < 1 || maxScan > 100000
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 1048576) throw new TypeError('Invalid runtime discovery allowance.');
  const root = await resolveSemanticPartPath(destination, 'generations');
  const requestId = semanticHash('pairofcleats.runtime.family-discovery.v1', { root: await fs.realpath(root), limit, maxScan, maxMs, maxBytes });
  let after = '';
  if (cursor !== null) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (Object.keys(value).length !== 4 || value.version !== 1 || value.requestId !== requestId
        || !/^[a-f0-9]{64}$/.test(value.after)
        || value.checksum !== semanticHash('pairofcleats.runtime.discovery-cursor.v1', { version: value.version, requestId, after: value.after })) throw new Error();
      after = value.after;
    } catch { throw runtimeImportError('Runtime discovery cursor mismatch.', 'ERR_RUNTIME_QUERY_CURSOR'); }
  }
  const deadline = Date.now() + maxMs, candidates = [];
  let scanned = 0;
  const check = () => {
    throwIfAborted(signal);
    if (Date.now() >= deadline) throw runtimeImportError('Runtime family discovery time allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
  };
  for await (const entry of await fs.opendir(root)) {
    check(); scanned += 1;
    if (scanned > maxScan) throw runtimeImportError('Runtime family discovery scan allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name) || entry.name <= after) continue;
    candidates.push(entry.name); candidates.sort(); if (candidates.length > limit + 1) candidates.pop();
  }
  const families = [];
  for (const generationId of candidates.slice(0, limit)) {
    check();
    const familyRoot = await resolveSemanticPartPath(root, generationId);
    const filename = await resolveSemanticPartPath(familyRoot, 'manifest.json');
    if ((await fs.stat(filename)).size > maxBytes) throw runtimeImportError('Runtime discovery manifest exceeds metadata byte allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
    const bytes = await fs.readFile(filename);
    // Discovery may describe an accepted same-format family without a lookup index;
    // lookup itself still rejects it and never substitutes a scan or legacy reader.
    const manifest = assertRuntimeFamily('inventoryManifest', JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (manifest.generationId !== generationId || semanticHash('pairofcleats.runtime.family.v1', { ...manifest, generationId: null }) !== generationId) throw runtimeImportError('Runtime discovery identity mismatch.');
    const captureFilename = await resolveSemanticPartPath(familyRoot, manifest.capture.path);
    if (manifest.capture.byteLength > maxBytes) throw runtimeImportError('Runtime discovery capture exceeds metadata byte allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
    await hashRuntimeFile({ filename: captureFilename, expectedHash: manifest.capture.hash, expectedBytes: manifest.capture.byteLength,
      maxBytes: 16 * 1024 * 1024, signal });
    const capture = assertRuntimeEvidence('capture', JSON.parse(await fs.readFile(captureFilename, 'utf8')));
    families.push({ generationId, captureId: capture.captureId, manifestHash: runtimeByteHash(bytes),
      queryIndexState: manifest.queryIndex ? 'available' : 'unavailable-reingest',
      repositoryNamespace: capture.repositoryNamespace, generation: capture.generation,
      sources: capture.sources,
      runtime: capture.runtime, workload: capture.workload, scope: capture.scope, completion: capture.completion });
    if (Buffer.byteLength(JSON.stringify(families)) > maxBytes - 1024) throw runtimeImportError('Runtime discovery response byte allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
  }
  const next = { version: 1, requestId, after: families.at(-1)?.generationId || after };
  const nextCursor = candidates.length > limit
    ? Buffer.from(canonicalSemanticJson({ ...next, checksum: semanticHash('pairofcleats.runtime.discovery-cursor.v1', next) })).toString('base64url') : null;
  return assertRuntimeQuery('discoveryResult', { schemaVersion: 1, executionAuthorized: false, families, nextCursor, scannedDirectories: scanned,
    warnings: ['Discovery is ordered by immutable generation identity. New imports require a new discovery pass to include earlier identities.'] });
};
