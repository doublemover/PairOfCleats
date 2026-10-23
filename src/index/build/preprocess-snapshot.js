import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertIndexCacheLease } from './cache-lease.js';
import { openContainedFile, verifyContainedFileHandle, readVerifiedContainedFile, assertNoSymlinkPath } from '../../shared/contained-file.js';
import { readExactAt } from '../../shared/io/read-exact.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { throwIfAborted } from '../../shared/abort.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { withSchedulerCpuSuspended } from '../../shared/concurrency/scheduler-task-scope.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../semantic/analysis-versions.js';
import { toRealPath } from '../../workspace/identity.js';

export const PREPROCESS_SNAPSHOT_VERSION = 1;
export const MAX_PREPROCESS_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_PREPROCESS_SAMPLE_BYTES = 1024 * 1024;
const MAX_MEMBERS = 200000;
// The envelope embeds JSON as a string; reserve its worst-case quote/backslash expansion.
const MAX_BODY_BYTES = Math.floor((MAX_PREPROCESS_SNAPSHOT_BYTES - 65536) / 2);
const COVERAGE = 'fresh-enumeration-filtered-candidates';
const IDENTITY_KEYS = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
const OUTPUT_KEYS = ['skip', 'scan', 'record', 'extractedProseCandidate', 'lines'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const changed = () => Object.assign(new Error('Source changed during preprocessing observation.'), { code: 'ERR_FILE_CHANGED' });
const inputKey = entry => sha256(stableStringifyForSignature({ rel: entry.rel, ext: entry.ext,
  isSpecial: entry.isSpecial, isManifest: entry.isManifest, isLock: entry.isLock, record: entry.record || null }));
const sameIdentity = (before, after) => IDENTITY_KEYS.every(key => before[key] === after[key]);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Hash/current identity always come from this opened descriptor. Source bytes are never retained. */
export const observePreprocessSource = async ({ root, entry, countLines = false, sampleBytes = 0,
  expectedHash = null, signal = null, metrics = {} }) => {
  if (!Number.isSafeInteger(sampleBytes) || sampleBytes < 0 || sampleBytes > MAX_PREPROCESS_SAMPLE_BYTES) throw new RangeError('Invalid preprocessing sample allowance.');
  throwIfAborted(signal);
  const handle = await openContainedFile(root, entry.abs);
  let primary = null;
  try {
    const before = await withSchedulerCpuSuspended(() => handle.stat());
    if (!Number.isSafeInteger(before.size) || before.size < 0 || (entry.stat && !sameIdentity(entry.stat, before))) throw changed();
    const hash = crypto.createHash('sha256');
    const scratch = Buffer.alloc(Math.min(65536, Math.max(1, before.size)));
    const sample = sampleBytes ? Buffer.alloc(Math.min(sampleBytes, before.size)) : null;
    let lfCount = 0;
    let position = 0;
    metrics.sourceReads = (metrics.sourceReads || 0) + 1;
    while (position < before.size) {
      const length = Math.min(scratch.length, before.size - position);
      const { bytesRead } = await withSchedulerCpuSuspended(() => readExactAt(handle, scratch, 0, length, position, { signal }));
      if (bytesRead !== length) throw changed();
      const bytes = scratch.subarray(0, bytesRead);
      hash.update(bytes);
      if (countLines) for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 10) lfCount += 1;
      if (sample && position < sample.length) bytes.copy(sample, position, 0, Math.min(bytes.length, sample.length - position));
      position += bytesRead;
      metrics.sourceBytes = (metrics.sourceBytes || 0) + bytesRead;
      metrics.hashedBytes = (metrics.hashedBytes || 0) + bytesRead;
    }
    throwIfAborted(signal);
    const after = await withSchedulerCpuSuspended(() => handle.stat());
    verifyContainedFileHandle(handle, root, entry.abs);
    if (!sameIdentity(before, after)) throw changed();
    const digest = hash.digest('hex');
    if (expectedHash !== null && digest !== expectedHash) throw changed();
    if (countLines) metrics.lineCountPasses = (metrics.lineCountPasses || 0) + 1;
    return { hash: digest, bytes: position, lines: countLines ? (position ? lfCount + 1 : 0) : null,
      sample, stat: after };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await withSchedulerCpuSuspended(() => handle.close()); } catch (error) {
      if (primary && typeof primary === 'object') primary.closeError = error;
      else throw error;
    }
  }
};

const boundedJsonValue = value => {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop(); nodes += 1;
    if (nodes > 2048 || item.depth > 10) return false;
    if (item.value === null || typeof item.value === 'boolean') continue;
    if (typeof item.value === 'number') { if (!Number.isFinite(item.value)) return false; continue; }
    if (typeof item.value === 'string') { if (item.value.length > 16384) return false; continue; }
    if (!item.value || typeof item.value !== 'object') return false;
    for (const [key, child] of Object.entries(item.value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
};
const validRecord = record => record === null || (record && !Array.isArray(record)
  && Object.keys(record).every(key => ['source', 'recordType', 'reason'].includes(key))
  && ['source', 'recordType', 'reason'].every(key => typeof record[key] === 'string' && record[key].length <= 256));
const validProduct = row => row && typeof row.rel === 'string' && row.rel.length > 0 && row.rel.length <= 32768
  && hex(row.inputKey) && hex(row.sourceHash) && Number.isSafeInteger(row.bytes) && row.bytes >= 0
  && row.output && typeof row.output === 'object' && !Array.isArray(row.output)
  && Object.keys(row.output).length === OUTPUT_KEYS.length && Object.keys(row.output).every(key => OUTPUT_KEYS.includes(key))
  && row.output.skip === null
  && row.output.scan && !Array.isArray(row.output.scan)
  && Object.keys(row.output.scan).length === 3
  && ['checkedBinary', 'checkedMinified', 'bypassBinarySkip'].every(key => typeof row.output.scan[key] === 'boolean')
  && validRecord(row.output.record)
  && (row.output.extractedProseCandidate === null || typeof row.output.extractedProseCandidate === 'boolean')
  && Number.isSafeInteger(row.output.lines) && row.output.lines >= 0 && boundedJsonValue(row.output);
const validMember = row => row && typeof row.rel === 'string' && row.rel.length > 0 && row.rel.length <= 32768
  && hex(row.inputKey) && Number.isSafeInteger(row.bytes) && row.bytes >= 0;
const policyWithinEnvelope = policy => {
  const pending = [policy];
  const seen = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  while (pending.length) {
    const value = pending.pop();
    if (++nodes > 16384) return false;
    if (value === null || value === undefined || typeof value === 'boolean') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) return false; continue; }
    if (typeof value === 'string') { bytes += Buffer.byteLength(value); if (bytes > 1024 * 1024) return false; continue; }
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (value instanceof RegExp) { bytes += Buffer.byteLength(value.source); continue; }
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    for (const [key, child] of Object.entries(value)) { bytes += Buffer.byteLength(key); pending.push(child); }
    if (bytes > 1024 * 1024) return false;
  }
  return true;
};
const projectOutput = entry => Object.fromEntries(OUTPUT_KEYS.map(key => [key, entry[key] ?? null]));
const applyOutput = (entry, output) => {
  for (const key of OUTPUT_KEYS) {
    if (output[key] === null || output[key] === undefined) delete entry[key];
    else entry[key] = structuredClone(output[key]);
  }
};

const loadPrevious = async ({ cacheRoot, snapshotPath, rootKey, policyKey, signal, metrics }) => {
  let envelope;
  try {
    const { buffer } = await readVerifiedContainedFile(cacheRoot, snapshotPath, { maxBytes: MAX_PREPROCESS_SNAPSHOT_BYTES, signal });
    metrics.snapshotReadBytes = buffer.length;
    envelope = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') { metrics.snapshotState = 'missing'; return null; }
    if (error instanceof SyntaxError || error?.code === 'ERR_FILE_TOO_LARGE') { metrics.snapshotState = 'invalid'; return null; }
    throw error;
  }
  if (envelope?.schemaVersion !== PREPROCESS_SNAPSHOT_VERSION || envelope?.complete !== true
    || envelope.rootKey !== rootKey || envelope.policyKey !== policyKey || typeof envelope.bodyJson !== 'string'
    || !hex(envelope.sha256) || sha256(envelope.bodyJson) !== envelope.sha256) {
    metrics.snapshotState = envelope?.policyKey !== policyKey ? 'policy-changed' : 'invalid'; return null;
  }
  let body;
  try { body = JSON.parse(envelope.bodyJson); } catch { metrics.snapshotState = 'invalid'; return null; }
  if (body?.coverage !== COVERAGE || !Array.isArray(body?.products) || !Array.isArray(body?.membership) || !Array.isArray(body?.skipped)
    || body.products.length > MAX_MEMBERS || body.membership.length > MAX_MEMBERS || body.skipped.length > MAX_MEMBERS
    || !body.products.every(validProduct)
    || !body.membership.every(validMember)) {
    metrics.snapshotState = 'invalid'; return null;
  }
  const membership = new Map();
  for (const row of body.membership) {
    if (membership.has(row.rel)) { metrics.snapshotState = 'invalid'; return null; }
    membership.set(row.rel, row);
  }
  const products = new Map();
  for (const row of body.products) {
    const member = membership.get(row.rel);
    if (products.has(row.rel) || !member || member.inputKey !== row.inputKey || member.bytes !== row.bytes) { metrics.snapshotState = 'invalid'; return null; }
    products.set(row.rel, row);
  }
  metrics.snapshotState = 'qualified-content-required';
  return { products, membership: new Set(membership.keys()) };
};

/** A cache lease seals products independently of generation promotion; membership is always enumerated again. */
export const createPreprocessSnapshotSession = async ({ root, snapshotCache, policy, sampleBytes, signal = null, metrics = {} }) => {
  if (!snapshotCache?.repoCacheRoot) return null;
  if (!policy.ignorePolicy || !Number.isSafeInteger(sampleBytes) || sampleBytes < 0 || sampleBytes > MAX_PREPROCESS_SAMPLE_BYTES) {
    metrics.snapshotState = !policy.ignorePolicy ? 'ignore-policy-unqualified' : 'sample-envelope'; return null;
  }
  const cacheRoot = path.resolve(snapshotCache.repoCacheRoot);
  assertIndexCacheLease(snapshotCache.lease, cacheRoot);
  const canonicalRoot = await toRealPath(root);
  const normalizeRoot = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalizeRoot(root) !== normalizeRoot(canonicalRoot)) { metrics.snapshotState = 'root-alias-unqualified'; return null; }
  if (!policyWithinEnvelope(policy)) { metrics.snapshotState = 'policy-envelope'; return null; }
  const rootKey = sha256(canonicalRoot);
  const policyKey = sha256(stableStringifyForSignature({ policy, producers: SEMANTIC_ANALYSIS_VERSIONS,
    node: process.versions.node, snapshotVersion: PREPROCESS_SNAPSHOT_VERSION }));
  const snapshotPath = path.join(cacheRoot, 'preprocess', 'snapshot.json');
  const previous = await loadPrevious({ cacheRoot, snapshotPath, rootKey, policyKey, signal, metrics });
  metrics.snapshotInputState = metrics.snapshotState;
  const products = new Map();
  let productBytes = 0;
  let persistenceEnvelopeExceeded = false;
  const retainProduct = row => {
    if (persistenceEnvelopeExceeded || products.has(row.rel)) return;
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (products.size >= MAX_MEMBERS || productBytes + bytes > MAX_BODY_BYTES) {
      persistenceEnvelopeExceeded = true; products.clear(); productBytes = 0; return;
    }
    productBytes += bytes; products.set(row.rel, row);
  };
  return {
    async reuse(entry) {
      const key = inputKey(entry);
      const cached = previous?.products.get(entry.rel);
      if (!cached || cached.inputKey !== key) {
        metrics.classificationMisses = (metrics.classificationMisses || 0) + 1;
        const observation = await observePreprocessSource({ root, entry, countLines: true, sampleBytes, signal, metrics });
        return { hit: false, observation };
      }
      const observation = await observePreprocessSource({ root, entry, countLines: false, sampleBytes, signal, metrics });
      if (observation.hash !== cached.sourceHash || observation.bytes !== cached.bytes) {
        metrics.classificationMisses = (metrics.classificationMisses || 0) + 1;
        metrics.contentChanges = (metrics.contentChanges || 0) + 1;
        return { hit: false, observation };
      }
      applyOutput(entry, cached.output);
      retainProduct(cached);
      metrics.classificationHits = (metrics.classificationHits || 0) + 1;
      if (Number.isSafeInteger(entry.lines)) metrics.lineCountHits = (metrics.lineCountHits || 0) + 1;
      return { hit: true, observation: null };
    },
    async countAndCapture(entry, earlier = null) {
      const observation = Number.isSafeInteger(earlier?.lines) ? earlier
        : await observePreprocessSource({ root, entry, countLines: true, expectedHash: earlier?.hash || null, signal, metrics });
      entry.lines = observation.lines;
      const row = { rel: entry.rel, inputKey: inputKey(entry), sourceHash: observation.hash, bytes: observation.bytes,
        output: projectOutput(entry) };
      // Capture the discovery input key before content sniffing changes record routing.
      row.inputKey = entry.preprocessInputKey || row.inputKey;
      if (validProduct(row)) retainProduct(row);
      metrics.lineCountMisses = (metrics.lineCountMisses || 0) + 1;
    },
    inputKey,
    async seal(entries, skipped, discoveryMetrics) {
      throwIfAborted(signal);
      assertIndexCacheLease(snapshotCache.lease, cacheRoot);
      if (discoveryMetrics.directoryErrors || discoveryMetrics.statFailures) { metrics.snapshotState = 'incomplete-discovery'; return; }
      if (entries.length > MAX_MEMBERS || skipped.length > MAX_MEMBERS) { metrics.snapshotState = 'membership-envelope'; return; }
      if (persistenceEnvelopeExceeded) { metrics.snapshotState = 'serialized-envelope'; return; }
      const membership = [];
      let bodyBytes = productBytes + 1024;
      for (const entry of entries) {
        const row = { rel: entry.rel, inputKey: entry.preprocessInputKey || inputKey(entry), bytes: entry.stat?.size ?? null };
        if (!validMember(row)) { metrics.snapshotState = 'invalid-membership'; return; }
        bodyBytes += Buffer.byteLength(JSON.stringify(row)) + 1;
        if (bodyBytes > MAX_BODY_BYTES) { metrics.snapshotState = 'serialized-envelope'; return; }
        membership.push(row);
      }
      for (const row of skipped) {
        if (!boundedJsonValue(row)) { metrics.snapshotState = 'skip-envelope'; return; }
        bodyBytes += Buffer.byteLength(JSON.stringify(row)) + 1;
        if (bodyBytes > MAX_BODY_BYTES) { metrics.snapshotState = 'serialized-envelope'; return; }
      }
      const current = new Set(membership.map(row => row.rel));
      metrics.membersAdded = previous ? [...current].filter(rel => !previous.membership.has(rel)).length : current.size;
      metrics.membersRemoved = previous ? [...previous.membership].filter(rel => !current.has(rel)).length : 0;
      const bodyJson = JSON.stringify({ coverage: COVERAGE, membership,
        skipped, products: [...products.values()], buildId: typeof snapshotCache.buildId === 'string' ? snapshotCache.buildId.slice(0, 256) : null });
      const envelope = { schemaVersion: PREPROCESS_SNAPSHOT_VERSION, complete: true, rootKey, policyKey,
        sha256: sha256(bodyJson), bodyJson };
      const encodedBytes = Buffer.byteLength(JSON.stringify(envelope));
      if (encodedBytes > MAX_PREPROCESS_SNAPSHOT_BYTES) { metrics.snapshotState = 'serialized-envelope'; return; }
      assertNoSymlinkPath(cacheRoot, snapshotPath, { allowMissing: true });
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
      await atomicWriteJson(snapshotPath, envelope, { signal, beforeCommit: () => {
        assertIndexCacheLease(snapshotCache.lease, cacheRoot);
        assertNoSymlinkPath(cacheRoot, snapshotPath, { allowMissing: true });
      } });
      metrics.snapshotState = 'sealed'; metrics.snapshotWriteBytes = encodedBytes; metrics.productsSealed = products.size;
      // Reuse the source hashes already observed above; diagnostics must not add
      // another source-tree hash pass. Exclude the allocating attempt/build id.
      const byPath = (a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
      metrics.sourceSnapshot = { schemaVersion: PREPROCESS_SNAPSHOT_VERSION,
        rootKey, policyKey, coverage: COVERAGE,
        identity: sha256(stableStringifyForSignature({ membership: [...membership].sort(byPath),
          products: [...products.values()].sort(byPath), skipped })),
        candidateCount: membership.length, capturedSourceCount: products.size,
        capturedSourceBytes: [...products.values()].reduce((sum, row) => sum + row.bytes, 0) };
    }
  };
};
