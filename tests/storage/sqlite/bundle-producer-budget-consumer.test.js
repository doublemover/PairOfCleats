import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve-current-process-envelope.js';
import { projectSqliteThreadLimits, resolveBundleProducerBudget } from '../../../src/storage/sqlite/build/bundle-budget.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { loadSqliteBundleWorkerProfile, saveSqliteBundleWorkerProfile } from '../../../src/storage/sqlite/build/runner/config.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-bundle-producer-budget');
const bundleDir = path.join(dir, 'bundles'), files = {}, samples = [];
const originalAvailable = os.availableParallelism, originalTotal = os.totalmem, originalFree = os.freemem;
const originalConstrained = process.constrainedMemory, originalAvailableMemory = process.availableMemory;
const pools = [];
globalThis.__bundleBudgetPools = pools;
const bundleIo = new URL('../../../src/shared/bundle-io.js', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'piscina' && context.parentURL?.endsWith('/src/storage/sqlite/build/bundle-loader.js')) {
    return { url: 'poc-budget:recording-pool', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'poc-budget:recording-pool') return { format: 'module', shortCircuit: true,
    source: `import { readBundleFile } from ${JSON.stringify(bundleIo)};
      export default class Pool {
        constructor(options) { this.options=options; this.active=0; this.peak=0; this.closed=0; globalThis.__bundleBudgetPools.push(this); }
        async run(task) { this.active++; this.peak=Math.max(this.peak,this.active); try {
          await new Promise(resolve=>setImmediate(resolve)); return await readBundleFile(task.bundlePath,{repoRoot:task.repoRoot});
        } finally { this.active--; } }
        async destroy() { this.closed++; }
      }` };
  return next(url, context);
} });
try {
  os.availableParallelism = () => 16;
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 12 * 1024 ** 3;
  process.constrainedMemory = () => 0; process.availableMemory = () => 12 * 1024 ** 3;
  const { resolveBundleWorkerAutotune } = await import('../../../src/storage/sqlite/build/runner/build.js');
  for (let ordinal = 0; ordinal < 96; ordinal++) {
    const file = `file-${ordinal}.js`, entry = { hash: `source-${ordinal}`, size: 1, mtimeMs: 1 };
    files[file] = { ...entry, ...await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
      bundles: [{ file, ...entry, chunks: [] }] }) };
  }
  const { createBundleLoader } = await import('../../../src/storage/sqlite/build/bundle-loader.js');
  for (const cpu of [1, 2, 8]) {
    const envelope = resolveCurrentProcessRuntimeEnvelope({ cpuCount: 16, argv: { threads: cpu },
      rawArgv: ['--threads', String(cpu)], env: {}, execArgv: [], userConfig: {} });
    const projected = projectSqliteThreadLimits(envelope);
    const threadLimits = { ...projected, totalMemBytes: 4 * 1024 ** 3, fileConcurrency: 32, ioConcurrency: 32 };
    const tuned = resolveBundleWorkerAutotune({ mode: 'code', manifestFiles: files, bundleDir, threadLimits,
      envConfig: {}, profile: { modes: { code: { threads: 16, resourceIdentity: 'prior-larger-host' } } } });
    assert.ok(tuned.threads <= cpu);
    const loader = createBundleLoader({ bundleThreads: 16, threadLimits,
      workerPath: path.resolve('src/storage/sqlite/build/bundle-loader-worker.js') });
    const metrics = {}, order = [];
    try {
      assert.equal(loader.admission.budget.cpu, cpu);
      assert.equal(loader.admission.budget.configuredMemoryBytes, threadLimits.totalMemBytes);
      assert.ok(loader.maxThreads <= cpu);
      for await (const row of loader.iterateBundleShards(Object.entries(files).map(([file, entry]) => ({ file, entry })),
        { bundleDir, maxBytes: 16 * 1024 ** 2, metrics })) {
        assert.equal(row.ok, true, row.reason); order.push(row.file);
      }
      assert.deepEqual(order, Object.keys(files)); assert.equal(metrics.currentReservedBytes, 0);
      assert.ok(metrics.peakPendingShards <= cpu);
      samples.push({ cpu, requested: 16, recommended: tuned.recommendedThreads, admitted: loader.admission,
        decoded: metrics.decodedShards, peakPending: metrics.peakPendingShards });
    } finally { await loader.close(); }
  }
  const tight = { threads: 8, cpuConcurrency: 8, maxConcurrencyCap: 8, totalMemBytes: 128 * 1024 ** 2 };
  const loader = createBundleLoader({ bundleThreads: 8, threadLimits: tight, workerPath: 'unused-recording-path' });
  try {
    assert.equal(loader.useWorkers, false); assert.equal(loader.admission.actualWorkerLimit, 0);
    assert.equal(loader.admission.budget.configuredMemoryBytes, tight.totalMemBytes);
    assert.equal(loader.workerAdmissionReason, 'effective-memory-cap');
  } finally { await loader.close(); }
  const fd = resolveBundleProducerBudget({ threads: 8, cpuConcurrency: 8, fdConcurrency: 2 });
  assert.equal(fd.limit, 2); assert.equal(fd.limitingReason, 'fd-budget');
  assert.equal(resolveBundleProducerBudget({}).limit, 1, 'missing admission cannot become host-wide fanout');
  const explicit = resolveBundleWorkerAutotune({ mode: 'code', manifestFiles: files, bundleDir,
    threadLimits: { threads: 1, cpuConcurrency: 1, fileConcurrency: 32 }, envConfig: { bundleThreads: 16 } });
  assert.equal(explicit.threads, 1, 'bundle override cannot expand the admitted global CPU ceiling');
  const profilePath = path.join(dir, 'sqlite/bundle-worker-autotune.json');
  await fs.mkdir(path.dirname(profilePath));
  await fs.writeFile(profilePath, JSON.stringify({ schemaVersion: '1.0.0', modes: { code: { threads: 16 } } }));
  assert.deepEqual((await loadSqliteBundleWorkerProfile(dir)).profile.modes, {});
  await saveSqliteBundleWorkerProfile({ profilePath, profile: { modes: { code: { threads: 2, resourceIdentity: fd.resourceIdentity } } } });
  assert.equal((await loadSqliteBundleWorkerProfile(dir)).profile.modes.code.resourceIdentity, fd.resourceIdentity);
  for (const pool of pools) { assert.equal(pool.closed, 1); assert.ok(pool.peak <= pool.options.maxThreads); }
  console.log(JSON.stringify({ scope: 'recording transport and actual ordered bundle reads; no native-worker throughput claim', pools: pools.length, samples }));
} finally {
  hooks.deregister(); delete globalThis.__bundleBudgetPools;
  os.availableParallelism = originalAvailable; os.totalmem = originalTotal; os.freemem = originalFree;
  process.constrainedMemory = originalConstrained; process.availableMemory = originalAvailableMemory;
  await fs.rm(dir, { recursive: true, force: true });
}
