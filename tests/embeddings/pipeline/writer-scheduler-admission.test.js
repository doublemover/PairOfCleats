import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { createEmbeddingWriterAdmission } from '../../../tools/build/embeddings/writer-admission.js';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
const name = SCHEDULER_QUEUE_NAMES.embeddingsIo;
for (const value of [undefined, null, 0, 1, 3]) {
  const scheduler = createBuildScheduler({ enabled: true, ioTokens: 8, cpuTokens: 2,
    queues: { [name]: { maxPending: value } } });
  let time = 0;
  const admission = createEmbeddingWriterAdmission({ scheduler, now: () => time });
  const expected = value > 0 ? value : 4;
  if (!(value > 0)) {
    assert.equal(scheduler.stats().queues[name].maxPending, null);
    assert.equal(Math.max(1, Number(scheduler.stats().queues[name].maxPending)), 1,
      'the old runner coercion reproduces the false one-write cap');
  }
  assert.equal(admission.initialLimit, expected);
  assert.ok(admission.resolve() >= expected);
  scheduler.registerQueue(name, { maxPending: 1 });
  time += 1000;
  assert.equal(admission.resolve(), 1, 'dynamic scheduler cap is honored');
  scheduler.registerQueue(name, { maxPending: null });
  time += 1000;
  if (expected > 1) assert.ok(admission.resolve() > 1, 'unlimited does not trap adaptive cap at one');
  await scheduler.shutdown();
}
// Exercise the actual scheduler -> admission -> writer contract, including byte
// backpressure, queued versus running work, and complete release on drain.
const scheduler = createBuildScheduler({ enabled: true, ioTokens: 1, cpuTokens: 1,
  queues: { [name]: {} } });
const admission = createEmbeddingWriterAdmission({ scheduler });
const writer = createBoundedWriterQueue({ maxPending: admission.initialLimit,
  resolveMaxPending: admission.resolve, maxPendingBytes: 12,
  scheduleIo: (fn) => scheduler.schedule(name, { io: 1 }, fn) });
let release;
const blocked = new Promise((resolve) => { release = resolve; });
await writer.enqueue(() => blocked, { bytes: 8 });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(scheduler.stats().queues[name].running, 1);
assert.equal(scheduler.stats().queues[name].pending, 0);
let secondAdmitted = false;
const second = writer.enqueue(async () => {}, { bytes: 8 }).then(() => { secondAdmitted = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(secondAdmitted, false);
assert.equal(writer.stats().pendingBytes, 8);
release();
await second;
await writer.onIdle();
assert.equal(writer.stats().pendingBytes, 0);
assert.equal(writer.stats().pending, 0);
assert.ok(writer.stats().peakPendingBytes <= 12);
await assert.rejects(writer.enqueue(async () => {}, { bytes: 13 }), /byte budget/);
await scheduler.shutdown();
console.log('scheduler to embedding writer admission contracts passed');

// Replay deterministic low-pressure telemetry over real scheduler queue stats.
// A hard cap tightened during cooldown must not wait for the pressure timer.
{
  const owner = createBuildScheduler({ enabled: true, ioTokens: 8, cpuTokens: 1,
    queues: { [name]: {} } });
  const observed = { stats: () => {
    const stats = owner.stats();
    return { ...stats, adaptive: { ...stats.adaptive,
      signals: { memory: { rssUtilization: 0.1, gcPressureScore: 0 } } } };
  } };
  let time = 0;
  const policy = createEmbeddingWriterAdmission({ scheduler: observed, now: () => time,
    indexingConfig: { embeddings: { writerAdaptiveStepMs: null, writerAdaptiveRssLow: null,
      writerAdaptiveRssHigh: null } } });
  assert.equal(policy.resolve(), 5);
  owner.registerQueue(name, { maxPending: 1 });
  time = 10;
  assert.equal(policy.resolve(), 1, 'hard shrink bypasses 500ms adaptive cooldown');
  owner.registerQueue(name, { maxPending: null });
  time = 20;
  assert.equal(policy.resolve(), 1, 'removing cap does not accelerate pressure-based expansion');
  time = 500;
  assert.equal(policy.resolve(), 3, 'restore floor and resume normal bounded expansion');
  await owner.shutdown();
}
