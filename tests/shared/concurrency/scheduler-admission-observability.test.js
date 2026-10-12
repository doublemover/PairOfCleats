import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { buildStage1SchedulerStallSnapshot, formatStage1SchedulerStallSummary } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';

async function checkBlocker({ config = {}, tokens, reason }) {
  let now = 0;
  const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1,
    now: () => now, ...config });
  let release;
  const first = scheduler.schedule('stage1.cpu', tokens, () => new Promise(resolve => { release = resolve; }));
  await tick();
  const controller = new AbortController();
  const second = scheduler.schedule('stage1.cpu', { ...tokens, signal: controller.signal }, () => {
    throw new Error('blocked work must not run');
  });
  const cancelled = assert.rejects(second, /abort/i);
  now = 100;
  const stats = scheduler.stats();
  const queue = stats.queues['stage1.cpu'];
  assert.equal(queue.running, 1);
  assert.equal(queue.pending, 1);
  assert.equal(queue.runnable, 0);
  assert.equal(queue.blocked, 1);
  assert.deepEqual(queue.blockedBy, { [reason]: 1 });
  assert.equal(queue.oldestWaitMs, 100, 'zero-epoch enqueue time is valid');
  assert.equal(queue.oldestRunningMs, 100);
  assert.equal(queue.runLatencyMs, null, 'unfinished tasks are not zero-duration samples');
  assert.equal(queue.waitLatencyMs.sampleCount, 1);
  const summary = formatStage1SchedulerStallSummary(buildStage1SchedulerStallSnapshot({ scheduler }));
  assert.ok(summary.includes(`ready0/blocked1/wait0s(${reason}:1)`));
  queue.blockedBy[reason] = 999;
  assert.equal(scheduler.stats().queues['stage1.cpu'].blockedBy[reason], 1, 'snapshots do not leak mutable state');
  controller.abort();
  await cancelled;
  release();
  await first;
  await tick();
  const final = scheduler.stats().queues['stage1.cpu'];
  assert.equal(final.running, 0);
  assert.equal(final.pending, 0);
  assert.equal(final.oldestRunningMs, 0);
  assert.equal(final.runLatencyMs.p95, 100);
  assert.equal(final.rejectedAbort, 1);
  await scheduler.shutdown();
}
await checkBlocker({ tokens: { cpu: 1 }, reason: 'cpu-tokens' });
await checkBlocker({ tokens: { io: 1 }, reason: 'io-tokens' });
await checkBlocker({ tokens: { mem: 1 }, reason: 'memory-tokens' });
await checkBlocker({ config: { queues: { 'stage1.cpu': { maxInFlightBytes: 10 } } }, tokens: { bytes: 6 }, reason: 'queue-bytes' });
await checkBlocker({ config: { maxInFlightBytes: 10 }, tokens: { bytes: 6 }, reason: 'global-bytes' });
await checkBlocker({ config: { adaptive: true, cpuTokens: 8,
  queues: { 'stage1.cpu': { surface: 'parse' } },
  adaptiveSurfaces: { parse: { minConcurrency: 1, maxConcurrency: 1, initialConcurrency: 1 } }
}, tokens: { cpu: 1 }, reason: 'surface-concurrency' });

// Existing trace captures before pump, so it can show runnable producer work
// without changing admission or dispatch just to manufacture a measurement.
let now = 0;
const scheduler = createBuildScheduler({ now: () => now, cpuTokens: 1, traceIntervalMs: 1 });
now = 2000;
await scheduler.schedule('ready', { cpu: 1 }, async () => {});
await tick();
const trace = scheduler.stats().telemetry.schedulingTrace.find(row => row.queues.ready?.runnable === 1);
assert.ok(trace, 'sampled trace preserves runnable/blocked admission state');
trace.queues.ready.blockedBy.fake = 1;
assert.equal(scheduler.stats().telemetry.schedulingTrace.some(row => row.queues.ready?.blockedBy.fake), false);
for (let i = 0; i < 100; i += 1) {
  now += 1;
  await scheduler.schedule('ready', { cpu: 1 }, async () => {});
}
await tick();
assert.equal(scheduler.stats().queues.ready.runLatencyMs.sampleCount, 64, 'latency storage stays bounded');
await scheduler.shutdown();
console.log('scheduler admission reasons, live ages, bounded wait/run latency and progress formatting passed');
