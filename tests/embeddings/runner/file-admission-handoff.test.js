import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { resolveFdConcurrencyCap } from '../../../src/index/build/workers/config.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { createEmbeddingFileAdmission, resolveEmbeddingFdCap } from '../../../tools/build/embeddings/file-admission.js';
import { resolveEmbeddingsFileParallelism, __runWithAdaptiveConcurrencyForTests as runFiles } from '../../../tools/build/embeddings/runner.js';

const name = SCHEDULER_QUEUE_NAMES.embeddingsCompute;
const scheduler = createBuildScheduler({ enabled: true, cpuTokens: 8, ioTokens: 8, queues: { [name]: {} } });
const staticFdCap = resolveFdConcurrencyCap(8, { fdSoftLimit: 1024 });
const initial = scheduler.stats();
assert.equal(initial.adaptive.fd, null);
assert.equal(resolveEmbeddingFdCap({ schedulerStats: initial, staticFdCap }), 8);
assert.equal(resolveEmbeddingsFileParallelism({ indexingConfig: {}, computeTokensTotal: 8,
  cpuConcurrency: 8, fdConcurrencyCap: resolveEmbeddingFdCap({ schedulerStats: initial, staticFdCap }) }), 8,
'missing scheduler sample must preserve static FD and token budgets at the production handoff');
for (const tokenCap of [undefined, null, 0, NaN]) {
  assert.equal(resolveEmbeddingFdCap({ schedulerStats: { adaptive: { fd: { tokenCap } } }, staticFdCap }), 8);
}
assert.equal(resolveEmbeddingFdCap({ schedulerStats: { adaptive: { fd: { tokenCap: 2 } } }, staticFdCap }), 2);
let time = 0, cap = null;
const observed = { stats: () => {
  const stats = scheduler.stats();
  return { ...stats, queues: { ...stats.queues, [name]: { ...stats.queues[name], pending: 1 } },
    adaptive: { ...stats.adaptive, fd: { tokenCap: cap },
      signals: { memory: { rssUtilization: 0.1, gcPressureScore: 0 } } } };
} };
const policy = createEmbeddingFileAdmission({ scheduler: observed, staticFdCap, baseConcurrency: 4,
  ceiling: 8, now: () => time, config: { adaptiveFileParallelismStepMs: null } });
assert.equal(policy.resolve(), 5);
cap = 1; time = 10;
assert.equal(policy.resolve(), 1, 'live FD cap may fall below the initial base during cooldown');
cap = null; time = 20;
assert.equal(policy.resolve(), 1, 'adaptive expansion waits for its cadence');
time = 500;
assert.equal(policy.resolve(), 2);

// Exercise the exact production file pump: existing work drains after a shrink;
// no replacement files launch while the remaining active count exceeds the cap.
const fixed = createEmbeddingFileAdmission({ scheduler: observed, staticFdCap, baseConcurrency: 4,
  ceiling: 4, adaptive: false });
const releases = [];
const started = [];
const run = runFiles({ items: [0, 1, 2, 3, 4, 5], initialConcurrency: 4,
  resolveConcurrency: fixed.resolve,
  worker: (id) => { started.push(id); return new Promise((resolve) => { releases[id] = resolve; }); } });
assert.deepEqual(started, [0, 1, 2, 3]);
cap = 1;
for (const id of [0, 1, 2]) {
  releases[id]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 4);
}
releases[3]();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(started, [0, 1, 2, 3, 4]);
cap = null;
releases[4]();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
releases[5]();
const result = await run;
assert.equal(result.peakConcurrency, 4);
assert.equal(result.finalConcurrency, 4);
assert.ok(result.adjustments >= 2);
await scheduler.shutdown();
console.log('scheduler FD telemetry -> embedding admission -> production file pump contracts passed');
