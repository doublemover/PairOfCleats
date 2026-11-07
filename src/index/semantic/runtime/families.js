import { readRuntimeMemberJson } from './verified-reads.js';
import fs from 'node:fs/promises';
import { assertRuntimeFamily } from '../../../contracts/validators/runtime-evidence-family.js';
import { assertRuntimeEvidence } from '../../../contracts/validators/runtime-evidence.js';
import { assertRuntimeQuery } from '../../../contracts/validators/runtime-query.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { semanticHash, canonicalSemanticJson } from '../identity.js';
import { runtimeByteHash, runtimeImportError } from './raw-store.js';
import { pageRuntimeFamilyCatalog } from './family-catalog.js';

/** Bounded discovery keeps only one page of identities; queries must explicitly pin returned generations. */
export const listRuntimeFamilies = async ({ destination, limit = 32, maxScan = 4096, maxMs = 1000, maxBytes = 65536, cursor = null, signal = null, metrics = null }) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(maxScan) || maxScan < 1 || maxScan > 100000
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 1048576) throw new TypeError('Invalid runtime discovery allowance.');
  const root = await fs.realpath(destination);
  const requestId = semanticHash('pairofcleats.runtime.family-discovery.v2', { root, limit, maxScan, maxMs, maxBytes });
  let after = '', snapshot = null;
  if (cursor !== null) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!value || Object.keys(value).sort().join(',') !== 'after,catalog,checksum,requestId,version'
        || value.version !== 2 || value.requestId !== requestId || !/^[a-f0-9]{64}$/.test(value.after)
        || value.checksum !== semanticHash('pairofcleats.runtime.discovery-cursor.v2', {
          version: value.version, requestId, after: value.after, catalog: value.catalog })) throw new Error();
      after = value.after; snapshot = value.catalog;
    } catch { throw runtimeImportError('Runtime discovery cursor mismatch.', 'ERR_RUNTIME_QUERY_CURSOR'); }
  }
  const deadline = Date.now() + maxMs;
  const check = () => {
    throwIfAborted(signal);
    if (Date.now() >= deadline) throw runtimeImportError('Runtime family discovery time allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
  };
  const page = await pageRuntimeFamilyCatalog({ destination: root, snapshot, after, limit, maxReads: maxScan, check, signal, metrics });
  const candidates = page.keys;
  const families = [];
  for (const generationId of candidates.slice(0, limit)) {
    check();
    const familyRoot = await resolveSemanticPartPath(root, 'generations/' + generationId);
    const manifestRead = await readRuntimeMemberJson({ root: familyRoot, relativePath: 'manifest.json', maxBytes, signal, metrics });
    const bytes = manifestRead.buffer;
    // Discovery may describe an accepted same-format family without a lookup index;
    // lookup itself still rejects it and never substitutes a scan or legacy reader.
    const manifest = assertRuntimeFamily('inventoryManifest', manifestRead.value);
    if (manifest.generationId !== generationId || semanticHash('pairofcleats.runtime.family.v1', { ...manifest, generationId: null }) !== generationId) throw runtimeImportError('Runtime discovery identity mismatch.');
    const capture = assertRuntimeEvidence('capture', (await readRuntimeMemberJson({ root: familyRoot,
      relativePath: manifest.capture.path, expectedHash: manifest.capture.hash, expectedBytes: manifest.capture.byteLength,
      maxBytes, signal, metrics })).value);
    families.push({ generationId, captureId: capture.captureId, manifestHash: runtimeByteHash(bytes),
      queryIndexState: manifest.queryIndex ? 'available' : 'unavailable-reingest',
      repositoryNamespace: capture.repositoryNamespace, generation: capture.generation,
      sources: capture.sources,
      runtime: capture.runtime, workload: capture.workload, scope: capture.scope, completion: capture.completion });
    if (Buffer.byteLength(JSON.stringify(families)) > maxBytes - 1024) throw runtimeImportError('Runtime discovery response byte allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
  }
  const next = { version: 2, requestId, after: families.at(-1)?.generationId || after, catalog: page.snapshot };
  const nextCursor = candidates.length > limit
    ? Buffer.from(canonicalSemanticJson({ ...next, checksum: semanticHash('pairofcleats.runtime.discovery-cursor.v2', next) })).toString('base64url') : null;
  const result = assertRuntimeQuery('discoveryResult', { schemaVersion: 1, executionAuthorized: false, families, nextCursor, scannedDirectories: 0,
    warnings: ['Discovery pins one catalog snapshot in immutable generation order. New imports require a new discovery pass.'] });
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw runtimeImportError('Runtime discovery response byte allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
  return result;
};
