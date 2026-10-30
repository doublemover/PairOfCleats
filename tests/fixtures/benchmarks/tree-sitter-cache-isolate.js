import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { getNativeTreeSitterParser, getNativeTreeSitterIdentity } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { ensureChunkCache, resolveChunkCacheKey, resolvePersistentChunkCachePaths, chunkCacheRetentionObservation } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { CHUNK_CACHE_LIMITS } from '../../../src/lang/tree-sitter/chunking/cache-schema.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { CACHE_MEASUREMENT_SHAPE, cacheMeasurementCorpus, summarizeCacheSamples } from './tree-sitter-cache-workload.js';
await requireBootstrap();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Original synchronous operations only. Instrumented work accounting is kept
 * separate from the clean parse-stage latency cohort below. */
const observeOperations = (parser, logicalRowBytes) => {
  assert.equal(typeof process.threadCpuUsage, 'function', 'actual per-thread CPU observation is required');
  const original = { parse: JSON.parse, stringify: JSON.stringify, clone: globalThis.structuredClone, native: parser.parse };
  const nativeDescriptor = Object.getOwnPropertyDescriptor(parser, 'parse');
  let active = null;
  const wrap = (name, operation, account) => function(...args) {
    if (!active) return Reflect.apply(operation, this, args);
    const target = active[name] ||= { calls: 0, cpuUs: 0, wallMs: 0, bytes: 0, failed: 0 };
    target.calls++; const cpu = process.threadCpuUsage(), at = performance.now(); let result, primary, failed = true;
    try { result = Reflect.apply(operation, this, args); failed = false; return result; }
    catch (error) { primary = error; throw error; }
    finally {
      try { const used = process.threadCpuUsage(cpu); target.cpuUs += used.user + used.system;
        target.wallMs += performance.now() - at; if (failed) target.failed++;
        else { const bytes = account(args, result); if (bytes === null) target.bytes = null;
        else if (target.bytes !== null) target.bytes += bytes; }
      } catch (inspection) { if (failed) throw addStorageFailureContext(primary, { phase: 'cache-qualification-operation-observation' }, inspection, { secondaryPresent: true }); throw inspection; }
    }
  };
  JSON.parse = wrap('jsonParse', original.parse, args => typeof args[0] === 'string' ? Buffer.byteLength(args[0]) : 0);
  JSON.stringify = wrap('jsonStringify', original.stringify, (_args, result) => typeof result === 'string' ? Buffer.byteLength(result) : 0);
  globalThis.structuredClone = wrap('clone', original.clone, args => Array.isArray(args[0])
    && args[0].length === CACHE_MEASUREMENT_SHAPE.declarations && typeof args[0][0]?.name === 'string'
    && typeof args[0][0]?.kind === 'string' && logicalRowBytes() > 0 ? logicalRowBytes() : null);
  parser.parse = wrap('nativeParse', original.native, args => Buffer.byteLength(args[0]));
  return { begin() { assert.equal(active, null); active = {}; }, end() { const result = active; active = null; return result; },
    restore() { active = null; JSON.parse = original.parse; JSON.stringify = original.stringify;
      globalThis.structuredClone = original.clone;
      if (nativeDescriptor) Object.defineProperty(parser, 'parse', nativeDescriptor); else delete parser.parse;
      assert.equal(parser.parse, original.native); } };
};

export default async request => {
  assert.ok(path.isAbsolute(request.workRoot)); assert.ok(request.gate instanceof SharedArrayBuffer);
  const marker = JSON.parse(fs.readFileSync(path.join(path.dirname(request.workRoot), 'artifact-benchmark-owner.json'), 'utf8'));
  assert.equal(marker.runIdentity, request.runIdentity); assert.equal(marker.workRoot, request.workRoot);
  const cacheRoot = path.join(request.workRoot, 'isolate-' + threadId); fs.mkdirSync(cacheRoot);
  const corpus = cacheMeasurementCorpus(), parser = getNativeTreeSitterParser('javascript'); assert.ok(parser);
  const base = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: true, chunkCacheMaxEntries: 64,
    cachePersistent: true, cachePersistentDir: cacheRoot, useQueries: request.useQueries } };
  const build = (source, caching = true, maxEntries = 64) => buildTreeSitterChunks({ languageId: 'javascript', text: source.text,
    options: { ...base, treeSitterCacheKey: source.sourceHash, treeSitter: { ...base.treeSitter, chunkCache: caching, chunkCacheMaxEntries: maxEntries } } });
  const clear = () => { treeSitterState.chunkCache.clear(); treeSitterState.persistentChunkCacheMemo.clear();
    treeSitterState.persistentChunkCacheMisses.clear(); chunkCacheRetentionObservation(); };
  const first = build(corpus[0], false); assert.equal(first.length, CACHE_MEASUREMENT_SHAPE.declarations);
  for (const [index, chunk] of first.entries()) { assert.equal(chunk.name, 'measured' + String(index).padStart(4, '0'));
    assert.equal(chunk.kind, 'FunctionDeclaration'); assert.ok(corpus[0].text.slice(chunk.start, chunk.end).startsWith('function ')); }
  const expected = new Map(), payloadBytes = new Map(), observations = [];
  let logicalRowBytes = 0;
  const operations = observeOperations(parser, () => logicalRowBytes);
  const metrics = () => ({ ...treeSitterState.metrics });
  const delta = before => Object.fromEntries(Object.entries(treeSitterState.metrics).filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => [key, value - (before[key] || 0)]));
  const verify = (source, rows, fresh = false) => {
    assert.equal(rows.length, CACHE_MEASUREMENT_SHAPE.declarations);
    const hash = digest(rows); if (fresh) { expected.set(source.sourceHash, hash); payloadBytes.set(source.sourceHash, Buffer.byteLength(JSON.stringify(rows))); }
    else { assert.equal(hash, expected.get(source.sourceHash)); assert.equal(Buffer.byteLength(JSON.stringify(rows)), payloadBytes.get(source.sourceHash)); }
    return hash;
  };
  const evidence = (name, prepare, action, fresh = false) => {
    const samples = [];
    for (const source of corpus) {
      prepare?.(source); logicalRowBytes = payloadBytes.get(source.sourceHash) || 0;
      const before = metrics(); operations.begin(); let rows, work;
      try { rows = action(source); } finally { work = operations.end(); }
      samples.push({ sourceHash: source.sourceHash, semanticHash: verify(source, rows, fresh), work, metrics: delta(before) });
    }
    observations.push({ name, cohort: 'instrumented-work;not-comparative-latency', samples });
    return samples;
  };
  let instrumentationFailed = false, instrumentationFailure;
  try {
    evidence('uncached-native-parse', () => clear(), source => build(source, false), true);
    const cold = evidence('absent-cache-native-production', () => clear(), source => build(source));
    assert.ok(cold.every(sample => sample.work.nativeParse?.calls === 1 && sample.metrics.chunkCachePersistentWrites === 1));
    const disk = evidence('disk-admission-empty-tiers', () => clear(), source => build(source));
    assert.ok(disk.every(sample => sample.work.jsonParse?.calls > 0 && !sample.work.nativeParse
      && sample.metrics.chunkCacheReadBytes > 0 && sample.metrics.chunkCacheReadBytes === sample.metrics.chunkCacheDecodedBytes));
    const hot = evidence('validated-memory-hit', source => { clear(); verify(source, build(source)); }, source => build(source));
    assert.ok(hot.every(sample => sample.metrics.chunkCacheHits === 1 && !sample.work.jsonParse && !sample.work.nativeParse
      && sample.work.clone?.calls > 0 && sample.work.clone.bytes > 0 && !sample.metrics.chunkCacheReadBytes));
    const migration = evidence('validated-legacy-migration', source => {
      clear(); const key = resolveChunkCacheKey({ ...base, treeSitterCacheKey: source.sourceHash }, 'javascript');
      const files = resolvePersistentChunkCachePaths(cacheRoot, key); assert.notEqual(files.canonical, files.legacy);
      for (const file of [files.canonical, files.legacy]) { const relative = path.relative(cacheRoot, file);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); }
      fs.mkdirSync(path.dirname(files.legacy), { recursive: true }); fs.renameSync(files.canonical, files.legacy);
    }, source => build(source));
    assert.ok(migration.every(sample => sample.work.jsonParse?.calls >= 1 && sample.work.jsonStringify?.bytes > 0 && !sample.work.nativeParse));
  } catch (error) { instrumentationFailed = true; instrumentationFailure = error; throw error; }
  finally {
    try { operations.restore(); }
    catch (cleanup) { if (instrumentationFailed) throw addStorageFailureContext(instrumentationFailure, {}, cleanup, { secondaryPresent: true }); throw cleanup; }
  }
  // No diagnostic wrappers remain on this actual latency cohort. Hash/content
  // checks and preparation are outside each original producer call interval.
  const latency = [];
  for (const mode of ['uncached-native-parse', 'disk-admission-empty-tiers', 'validated-memory-hit']) {
    const raw = [];
    for (const source of corpus) {
      clear(); if (mode === 'validated-memory-hit') verify(source, build(source));
      const at = performance.now(), rows = build(source, mode !== 'uncached-native-parse');
      raw.push(performance.now() - at); verify(source, rows);
    }
    latency.push({ mode, rawMs: raw, summary: summarizeCacheSamples(raw), scope: 'original-synchronous-producer-call;validation-outside' });
  }
  clear(); ensureChunkCache({ treeSitter: { ...base.treeSitter, chunkCacheMaxEntries: 2 } });
  for (const source of corpus.slice(0, 4)) verify(source, build(source, true, 2));
  assert.ok(treeSitterState.chunkCache.size <= 2 && treeSitterState.persistentChunkCacheMemo.size <= 2);
  const countPressure = chunkCacheRetentionObservation(); clear();
  const beforePressure = metrics();
  for (const source of corpus) verify(source, build(source));
  const retention = chunkCacheRetentionObservation(), pressure = delta(beforePressure);
  assert.ok(pressure.chunkCacheByteEvictions > 0, 'actual corpus must reach the unchanged byte budget before the64-entry cap');
  assert.ok(retention.retainedBytes > CHUNK_CACHE_LIMITS.maxRetainedBytes / 2 && retention.retainedBytes <= CHUNK_CACHE_LIMITS.maxRetainedBytes);
  assert.ok(treeSitterState.chunkCache.size < 64); assert.ok(treeSitterState.persistentChunkCacheMemo.size < 64);
  assert.equal(treeSitterState.metrics.fallbacks, 0, 'fallback work cannot qualify native cache measurements');
  if (request.useQueries) { assert.ok(treeSitterState.metrics.queryBuilds > 0); assert.equal(treeSitterState.metrics.queryFailures, 0); }
  const report = { schemaVersion: 1, threadId, useQueries: request.useQueries, sources: corpus.length,
    corpusHash: digest(corpus.map(source => source.sourceHash)), semanticCorpusHash: digest([...expected]),
    nativeIdentity: getNativeTreeSitterIdentity('javascript'), observations, latency, countPressure, retention, pressure,
    actualMetrics: metrics(),
    memoryAtHeldBoundary: process.memoryUsage(), limits: CHUNK_CACHE_LIMITS,
    workAccounting: 'actual scoped JSON/native calls;clone bytes are logical UTF8 row-payload equivalents, not heap allocation',
    claim: 'same-output fresh/disk/hot comparison;no historical-reader or speedup claim' };
  const gate = new Int32Array(request.gate); Atomics.add(gate, 0, 1); Atomics.notify(gate, 0);
  await Atomics.waitAsync(gate, 1, 0).value;
  return report;
};
