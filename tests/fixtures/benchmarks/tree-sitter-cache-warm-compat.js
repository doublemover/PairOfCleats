import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { cacheMeasurementCorpus, CACHE_MEASUREMENT_SHAPE, summarizeCacheSamples } from './tree-sitter-cache-workload.js';

await requireBootstrap(); applyTestEnv();
const [arm, destination] = process.argv.slice(2);
assert.ok(['original', 'current'].includes(arm)); assert.ok(destination && path.isAbsolute(destination));
await fs.mkdir(destination);
const hash = value => createHash('sha256').update(value).digest('hex');
const target = new URL('../../../src/lang/tree-sitter/chunking/cache.js', import.meta.url).href;
const baselinePath = new URL('./tree-sitter-cache-original-24230.js.txt', import.meta.url);
const baselinePhysical = await fs.readFile(baselinePath), baselineSource = baselinePhysical.toString('utf8').replace(/\r\n/g, '\n');
assert.equal(hash(baselineSource), '423c432d27761bab4dac6669bea036965e80757151cda0f29644f19c7ed37562');
assert.equal(createHash('sha1').update('blob ' + Buffer.byteLength(baselineSource) + '\0').update(baselineSource).digest('hex'),
  '6fbcb98148f1dfc3f9092ceef8cdc91426aa6ee2', 'exact issue-pinned Git blob, with checkout CRLF restored to original LF');
let interceptions = 0;
const hook = arm === 'original' ? registerHooks({ load(url, context, next) {
  if (url !== target) return next(url, context);
  interceptions++; return { format: 'module', source: baselineSource, shortCircuit: true };
} }) : null;
const cacheRoot = path.join(destination, 'cache-input'); await fs.mkdir(cacheRoot);
const rootIdentity = await fs.lstat(cacheRoot, { bigint: true });
let failed = false, primary, report;
try {
  // Imports follow the exact load boundary so the original owner's relative
  // dependencies resolve at its production URL; all other owners stay current.
  const { buildTreeSitterChunks } = await import('../../../src/lang/tree-sitter/chunking.js');
  const { treeSitterState } = await import('../../../src/lang/tree-sitter/state.js');
  const cache = await import('../../../src/lang/tree-sitter/chunking/cache.js');
  assert.equal(interceptions, arm === 'original' ? 1 : 0);
  const corpus = cacheMeasurementCorpus(), expected = new Map(), witnesses = [], physical = [];
  const options = { treeSitter: { enabled: true, strict: true, adaptive: false, useQueries: false,
    chunkCache: true, chunkCacheMaxEntries: 64, cachePersistent: true, cachePersistentDir: cacheRoot } };
  const request = (source, enabled = true) => ({ languageId: 'javascript', text: source.text,
    options: { ...options, treeSitterCacheKey: source.sourceHash,
      treeSitter: { ...options.treeSitter, chunkCache: enabled } } });
  const build = (source, enabled = true) => buildTreeSitterChunks(request(source, enabled));
  const clear = () => {
    treeSitterState.chunkCache.clear(); treeSitterState.persistentChunkCacheMemo.clear();
    treeSitterState.persistentChunkCacheMisses.clear();
  };
  const expectedNames = Array.from({ length: CACHE_MEASUREMENT_SHAPE.declarations }, (_, index) =>
    'measured' + String(index).padStart(4, '0'));
  for (const source of corpus) {
    const rows = build(source, false);
    assert.deepEqual(rows.map(row => row.name), expectedNames);
    assert.ok(rows.every(row => row.kind === 'FunctionDeclaration' && row.start >= 0 && row.end <= source.text.length));
    expected.set(source.sourceHash, rows);
    witnesses.push({ sourceHash: source.sourceHash, sourceBytes: Buffer.byteLength(source.text),
      semanticSha256: hash(JSON.stringify(rows)), rowBytes: Buffer.byteLength(JSON.stringify(rows)), rows: rows.length });
  }
  clear();
  for (const source of corpus) {
    assert.deepEqual(build(source), expected.get(source.sourceHash));
    const key = cache.resolveChunkCacheKey(request(source).options, 'javascript');
    const filename = cache.resolvePersistentChunkCachePaths(cacheRoot, key).canonical;
    const bytes = await fs.readFile(filename), envelope = JSON.parse(bytes);
    assert.deepEqual(envelope.chunks, expected.get(source.sourceHash));
    assert.equal(envelope.schemaVersion, arm === 'original' ? '1.0.0' : '2.0.0');
    physical.push({ path: filename, key, bytes: bytes.length, sha256: hash(bytes), schema: envelope.schemaVersion,
      rowSha256: hash(JSON.stringify(envelope.chunks)) });
  }
  const phases = [];
  for (const mode of ['file-admission', 'memory-warm', 'persistent-memo-warm']) {
    clear();
    const samples = [];
    for (const source of corpus) {
      let priming = null;
      if (mode === 'file-admission') clear();
      else {
        // All32 large products need not remain resident under the unchanged
        // byte budget. Qualify the declared warm tier for each actual sample,
        // while preserving the complete corpus and reporting untimed setup.
        const at = performance.now(), visits = treeSitterState.metrics.projectionVisits || 0;
        const before = { memoryHits: treeSitterState.metrics.chunkCacheHits || 0,
          persistedHits: treeSitterState.metrics.chunkCachePersistentHits || 0 };
        assert.deepEqual(build(source), expected.get(source.sourceHash));
        const key = cache.resolveChunkCacheKey(request(source).options, 'javascript');
        const tier = mode === 'memory-warm' ? treeSitterState.chunkCache : treeSitterState.persistentChunkCacheMemo;
        assert.ok(tier.has(key), 'the exact measured input must reside in its declared warm tier');
        assert.equal(treeSitterState.metrics.projectionVisits || 0, visits, 'priming reuses a valid existing cache product');
        priming = { wallMs: performance.now() - at,
          memoryHits: (treeSitterState.metrics.chunkCacheHits || 0) - before.memoryHits,
          persistedHits: (treeSitterState.metrics.chunkCachePersistentHits || 0) - before.persistedHits,
          scope: 'untimed per-input admission and exact parity;full32-source corpus;original byte limits' };
        if (mode === 'persistent-memo-warm') treeSitterState.chunkCache.clear();
      }
      const memoryHits = treeSitterState.metrics.chunkCacheHits || 0;
      const persistedHits = treeSitterState.metrics.chunkCachePersistentHits || 0;
      const visits = treeSitterState.metrics.projectionVisits || 0;
      const cpu = process.threadCpuUsage(), started = performance.now();
      const rows = build(source);
      const wallMs = performance.now() - started, used = process.threadCpuUsage(cpu);
      assert.deepEqual(rows, expected.get(source.sourceHash));
      assert.equal(treeSitterState.metrics.projectionVisits || 0, visits, 'the original hit bypasses native projection');
      if (mode === 'memory-warm') assert.equal(treeSitterState.metrics.chunkCacheHits, memoryHits + 1);
      else assert.equal(treeSitterState.metrics.chunkCachePersistentHits, persistedHits + 1);
      samples.push({ sourceHash: source.sourceHash, wallMs, cpu: used, priming, semanticSha256: hash(JSON.stringify(rows)) });
    }
    phases.push({ mode, samples, latency: summarizeCacheSamples(samples.map(row => row.wallMs)),
      scope: '32 clean actual native entrypoint calls;clears/priming/assertions/hashes excluded;OS file cache uncontrolled' });
  }
  for (const entry of physical) assert.equal(hash(await fs.readFile(entry.path)), entry.sha256, 'healthy physical cache input remains immutable');
  report = { arm, sourceOwner: arm === 'original' ? { revision: '24230d7960127ab7e4a01f2c040bf3d859f6b46b',
    productionPath: 'src/lang/tree-sitter/chunking/cache.js', gitBlob: '6fbcb98148f1dfc3f9092ceef8cdc91426aa6ee2',
    sha256: hash(baselineSource), fixturePhysicalSha256: hash(baselinePhysical), interceptions,
    scope: 'only exact original cache owner under current dependencies/native producer;not historical whole checkout' }
    : { productionPath: 'src/lang/tree-sitter/chunking/cache.js', sha256: hash(await fs.readFile(fileURLToPath(target))), interceptions },
  corpus: witnesses, physical, phases, sourceCorpusSha256: hash(JSON.stringify(witnesses.map(row => row.sourceHash))),
  semanticCorpusSha256: hash(JSON.stringify(witnesses.map(row => row.semanticSha256))),
  scope: 'same authored source and exact current-native rows;each owner writes its supported schema1/2 envelope;healthy cache only;no gain or historical whole-tree claim' };
} catch (error) { failed = true; primary = error; throw error; }
finally {
  let cleanupFailed = false, cleanupFailure;
  try { hook?.deregister(); }
  catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; }
  try {
    const current = await fs.lstat(cacheRoot, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === rootIdentity.dev && current.ino === rootIdentity.ino);
    assert.equal(path.dirname(cacheRoot), destination);
    await fs.rm(cacheRoot, { recursive: true, force: true });
  } catch (cleanup) {
    cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, { phase: 'native-cache-baseline-hook-cleanup' }, cleanup,
      { secondaryPresent: true }) : cleanup;
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    if (failed) throw addStorageFailureContext(primary, { phase: 'native-cache-warm-comparison-cleanup' }, cleanupFailure, { secondaryPresent: true });
    throw cleanupFailure;
  }
}
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', historicalAuthorWorkspace: true,
  node: process.version, platform: process.platform, pid: process.pid, generatedWork: 'original uniquely owned cache removed', report }, { createOnly: true });
