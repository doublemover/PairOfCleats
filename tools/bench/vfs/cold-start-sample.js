import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createVfsColdStartCache, ensureVfsDiskDocument, resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { checksumString, getXxhashBackend } from '../../../src/shared/hash.js';
import { VFS_COLD_START_MAX_BYTES } from '../../../src/index/tooling/vfs/constants.js';
import { VFS_COLD_MAX_ENTRIES } from '../../../src/index/tooling/vfs/cold-start-owner.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';

export const admitVfsColdStartWork = ({ docs, docBytes, samples, content = 'ascii' }) => {
  if (!['ascii', 'utf8'].includes(content)) throw new RangeError('Cold-start content must be ascii or utf8.');
  for (const [name, value, minimum] of [['docs', docs, 1], ['docBytes', docBytes, 8], ['samples', samples, 1]]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid cold-start benchmark ${name}.`);
  }
  if (docs > VFS_COLD_MAX_ENTRIES || docBytes > VFS_COLD_START_MAX_BYTES
    || !Number.isSafeInteger(docs * docBytes) || docs * docBytes > VFS_COLD_START_MAX_BYTES * 2) {
    throw new RangeError('Cold-start benchmark exceeds 50,000 documents, 64 MiB per document or 128 MiB total.');
  }
  return { docs, docBytes, samples, content };
};

export const buildVfsColdStartPlan = async ({ docs, docBytes, content = 'ascii' }) => {
  admitVfsColdStartWork({ docs, docBytes, samples: 1, content });
  const documents = [], witness = createHash('sha256'), contentHashes = new Set();
  let totalBytes = 0;
  for (let index = 0; index < docs; index++) {
    const prefix = `doc-${index}-`.slice(0, docBytes), remaining = docBytes - Buffer.byteLength(prefix);
    const unit = content === 'utf8' ? 'π😀' : 'x', unitBytes = Buffer.byteLength(unit);
    const text = prefix + unit.repeat(Math.floor(remaining / unitBytes)) + 'x'.repeat(remaining % unitBytes);
    const hashed = await checksumString(text);
    if (hashed?.algo !== 'xxh64' || hashed.value === null || hashed.value === undefined || !String(hashed.value)) throw new Error('VFS benchmark source hash is unavailable.');
    const docHash = `xxh64:${hashed.value}`, bytes = Buffer.byteLength(text, 'utf8');
    const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    const document = Object.freeze({ virtualPath: `.poc-vfs/src/doc-${index}.txt`, text, docHash, bytes, sha256 });
    documents.push(document); totalBytes += bytes; contentHashes.add(sha256);
    witness.update(JSON.stringify([document.virtualPath, docHash, bytes, sha256])); witness.update('\n');
  }
  return Object.freeze({ documents: Object.freeze(documents), identity: Object.freeze({ generator: content === 'utf8' ? 'fixed-byte-utf8-documents-v3' : 'fixed-byte-ascii-documents-v2',
    docs, requestedDocBytes: docBytes, actualUtf8Bytes: totalBytes, uniqueContentHashes: contentHashes.size,
    sha256: witness.digest('hex'), docHashAlgorithm: 'xxh64', hashBackend: await getXxhashBackend() }) });
};

const emptyCounts = () => ({ documents: 0, created: 0, regenerated: 0, persistedHits: 0, memoryHits: 0,
  existingVerified: 0, bytesWritten: 0, contentVerificationBytes: 0 });

/** One scenario/sample per fresh worker. Adapters are private deterministic
 * controls; the normal path uses real materialization and cache owners. */
export const runVfsColdStartSample = async ({ mode, rootDir, plan, cacheConfig = {} }, {
  createCache = createVfsColdStartCache, ensureDocument = ensureVfsDiskDocument,
  readFile = null, now = () => performance.now()
} = {}) => {
  if (!['cold', 'warm', 'hot'].includes(mode) || !path.isAbsolute(rootDir) || !Array.isArray(plan?.documents)
    || !plan.documents.length || plan.documents.length !== plan.identity?.docs) throw new TypeError('Invalid VFS benchmark sample.');
  const baseDir = path.join(rootDir, 'vfs'), cacheRoot = path.join(rootDir, 'cache');
  const counts = emptyCounts(), warmup = emptyCounts();
  const loadStart = now();
  const cache = mode === 'hot' ? null : await createCache({ cacheRoot, indexSignature: plan.identity.sha256,
    manifestHash: `sha256:${plan.identity.sha256}`, config: { ...cacheConfig, enabled: true, cacheRoot } });
  const cacheLoadMs = mode === 'hot' ? 0 : now() - loadStart;
  const initialCache = cache?.stats?.() || null;
  const perform = async (document, totals, coldStartCache) => {
    const result = await ensureDocument({ baseDir, virtualPath: document.virtualPath, text: document.text,
      docHash: document.docHash, coldStartCache });
    if (!result?.materialization || result.materialization.sha256 !== document.sha256
      || result.materialization.sizeBytes !== document.bytes || typeof result.cacheHit !== 'boolean'
      || !['memory', 'cold-start', 'existing-verified', 'created', 'regenerated'].includes(result.source)
      || !Number.isSafeInteger(result.materialization.verificationBytes) || result.materialization.verificationBytes < 0
      || result.materialization.verificationBytes > document.bytes
      || result.path !== resolveVfsDiskPath({ baseDir, virtualPath: document.virtualPath })) throw new Error('VFS sample returned unqualified content identity.');
    totals.documents++; totals.contentVerificationBytes += result.materialization.verificationBytes;
    if (!result.cacheHit) { totals.created++; totals.bytesWritten += document.bytes; if (result.source === 'regenerated') totals.regenerated++; }
    else if (result.source === 'cold-start') totals.persistedHits++;
    else if (result.source === 'memory') totals.memoryHits++;
    else if (result.source === 'existing-verified') totals.existingVerified++;
    else throw new Error('VFS sample returned an unknown reuse phase.');
    return result.path;
  };
  const warmupStart = now();
  if (mode === 'hot') for (const document of plan.documents) await perform(document, warmup, null);
  const warmupMs = mode === 'hot' ? now() - warmupStart : 0;
  const accessed = [], accessStart = now();
  for (const document of plan.documents) accessed.push(await perform(document, counts, cache));
  const documentAccessMs = now() - accessStart;
  const flushStart = now(); if (cache) await cache.flush();
  const flushMs = cache ? now() - flushStart : 0, finalCache = cache?.stats?.() || null;
  // Independent consumer reads outside timing; receipts alone cannot pass parity.
  const output = createHash('sha256');
  for (let index = 0; index < accessed.length; index++) {
    const expected = plan.documents[index];
    const bytes = readFile ? await readFile(accessed[index]) : (await readVerifiedContainedFile(baseDir, accessed[index], {
      maxBytes: expected.bytes, expectedBytes: expected.bytes
    })).buffer;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected.bytes
      || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('VFS sample consumer read different bytes.');
    output.update(JSON.stringify([expected.virtualPath, expected.sha256])); output.update('\n');
  }
  const reasons = [];
  if (mode === 'cold' && (counts.created !== plan.documents.length || initialCache?.loadedEntries !== 0)) reasons.push('cold-phase-reused-existing-state');
  if (mode === 'warm' && (initialCache?.loadedEntries !== plan.documents.length || counts.persistedHits !== plan.documents.length)) reasons.push('persisted-admission-or-hit-coverage-incomplete');
  if (mode === 'hot' && counts.memoryHits !== plan.documents.length) reasons.push('in-process-hit-coverage-incomplete');
  if (cache && finalCache.flushes - initialCache.flushes !== 1) reasons.push('persistence-obligation-incomplete');
  return { schemaVersion: 2, mode, state: reasons.length ? 'unqualified-phase' : 'qualified-phase', reasons,
    pid: process.pid, workload: plan.identity, counts, warmup, initialCache, finalCache,
    phases: { cacheLoadMs, warmupMs, documentAccessMs, flushMs, totalMs: cacheLoadMs + documentAccessMs + flushMs },
    totalScope: mode === 'hot' ? 'verified-in-process-access-only;warmup-excluded' : 'cache-admission-document-access-and-persistence',
    cacheLoadByteScope: 'loadedInputBytes-counts-cache-data-descriptor-bytes;metadata-bytes-unobserved',
    consumerParity: { state: 'byte-identical', sha256: output.digest('hex'), bytes: plan.identity.actualUtf8Bytes, includedInTiming: false },
    nativeIoScope: 'content-verification-and-document-write-bytes;metadata-and-OS-cache-IO-unmeasured' };
};
