import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import Piscina from 'piscina';
import { createIndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { destroyPiscinaPool } from '../../../src/shared/piscina-cleanup.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { createSqliteBenchWorkspace } from '../../../tools/bench/sqlite/shared.js';
import { observeMapProcessMemory } from '../../../tools/bench/map/observation.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { CACHE_MEASUREMENT_SHAPE } from './tree-sitter-cache-workload.js';
await requireBootstrap();
const request = JSON.parse(process.argv[2] || '{}');
assert.ok(CACHE_MEASUREMENT_SHAPE.workerCounts.includes(request.workers)); assert.equal(typeof request.useQueries, 'boolean');
const workspace = await createSqliteBenchWorkspace({ name: 'tree-sitter-cache-qualification' });
const gate = new SharedArrayBuffer(8), flags = new Int32Array(gate), before = process.memoryUsage();
const pool = createIndexerThreadPool(Piscina, { filename: fileURLToPath(new URL('./tree-sitter-cache-isolate.js', import.meta.url)),
  minThreads: request.workers, maxThreads: request.workers, maxQueue: request.workers, idleTimeout: 30000 });
let failed = false, stopping = false, primary, reports, heldMemory, memory, closure;
const jobs = Array.from({ length: request.workers }, () => pool.run({ workRoot: workspace.workRoot,
  runIdentity: workspace.workOwner.runIdentity, useQueries: request.useQueries, gate }));
const joined = Promise.all(jobs); void joined.catch(() => {});
try {
  const ready = async () => {
    while (!stopping && Atomics.load(flags, 0) < request.workers) {
      const observed = Atomics.load(flags, 0);
      if (observed >= request.workers) break;
      await Atomics.waitAsync(flags, 0, observed, 25000).value;
    }
  };
  await runWithTimeout(() => Promise.race([ready(), joined.then(() => { throw new Error('Worker returned before held-cache observation.'); })]),
    { timeoutMs: 25000, errorFactory: () => new Error('Actual cache-isolate work did not reach its bounded held boundary.') });
  heldMemory = process.memoryUsage();
  memory = observeMapProcessMemory({ before, after: heldMemory, through: 'all-original-isolates-held-before-original-pool-destroy' });
  assert.equal(memory.processLifetimeRss.state, 'observed', 'actual native process high-water is required');
  Atomics.store(flags, 1, 1); Atomics.notify(flags, 1);
  reports = await joined;
  assert.equal(new Set(reports.map(row => row.threadId)).size, request.workers);
  assert.equal(new Set(reports.map(row => row.corpusHash)).size, 1);
  assert.equal(new Set(reports.map(row => row.semanticCorpusHash)).size, 1);
  assert.ok(reports.every(row => row.nativeIdentity?.runtimeKind === 'native-tree-sitter'));
} catch (error) { failed = true; primary = error; throw error; }
finally {
  stopping = true; Atomics.notify(flags, 0);
  Atomics.store(flags, 1, 1); Atomics.notify(flags, 1);
  try {
    closure = await destroyPiscinaPool(pool, { label: 'cache-qualification-original-isolates', destroyTimeoutMs: 5000, terminateTimeoutMs: 1000 });
    if (closure.skipped || closure.timedOut || closure.forced || pool.threads.length !== 0) throw new Error('Cache measurement requires confirmed ordinary original worker closure.');
  } catch (cleanup) {
    console.error(JSON.stringify({ generatedWorkRetained: workspace.workRoot, runIdentity: workspace.workOwner.runIdentity }));
    if (failed) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }); throw cleanup;
  }
  if (failed) console.error(JSON.stringify({ generatedWorkRetained: workspace.workRoot, runIdentity: workspace.workOwner.runIdentity }));
}
const generatedWork = await workspace.workOwner.reclaim();
console.log(JSON.stringify({ schemaVersion: 1, state: 'qualified-native-cache-observations', workers: request.workers,
  useQueries: request.useQueries, shape: CACHE_MEASUREMENT_SHAPE, pid: process.pid, node: process.version,
  platform: process.platform, arch: process.arch, memory, heldMemory, closure, generatedWork, reports,
  perWorkerMultiplication: { observedIsolates: reports.length, chargedBytes: reports.map(row => row.retention.retainedBytes),
    sumChargedBytes: reports.reduce((sum, row) => sum + row.retention.retainedBytes, 0),
    sumConfiguredLimits: reports.reduce((sum, row) => sum + row.limits.maxRetainedBytes, 0),
    accounting: 'logical retained-cache charges per isolate;not aggregate RSS cap or attributed per-worker RSS' },
  scope: 'fresh-process native RSS through simultaneously-held original isolates;includes bootstrap/grammar/oracles/all phases;no gain claim' }));
