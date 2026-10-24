#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check()); };
const signal = new AbortController().signal;
const scheduler = createBuildScheduler({ cpuTokens: 2, ioTokens: 2, memoryTokens: 2, maxInFlightBytes: 1000,
  requireSignals: true, queues: { cpu: { concurrency: 2, maxPending: 8, maxInFlightBytes: 1000 } } });
try {
  const gate = deferred(); let waiting = 0;
  const blocked = [1, 2].map(() => scheduler.schedule('cpu', { cpu: 1, bytes: 100, signal }, async () => {
    await withSchedulerCpuSuspended(() => scheduler.schedule('io', { io: 1, signal }, async () => {
      waiting++; await gate.promise;
    }));
    assert.ok(scheduler.stats().tokens.cpu.used >= 1, 'compute continuation reacquires CPU');
  }));
  await until(() => waiting === 2);
  const waitingStats = scheduler.stats();
  assert.equal(waitingStats.tokens.cpu.used, 0); assert.equal(waitingStats.tokens.io.used, 2);
  assert.equal(waitingStats.activity.inFlightBytes, 200, 'file reservations survive I/O suspension');
  assert.equal(waitingStats.queues.cpu.suspendedCpu, 2);
  await scheduler.schedule('cpu', { cpu: 1, bytes: 100, signal }, async () => 'ready');
  assert.equal(waiting, 2, 'ready CPU work completes while both I/O jobs remain blocked');
  gate.resolve(); await Promise.all(blocked); await tick();
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  const first = deferred(), second = deferred(); let completed = false;
  const parallel = scheduler.schedule('cpu', { cpu: 1, signal }, async () => {
    await Promise.all([
      withSchedulerCpuSuspended(() => first.promise),
      withSchedulerCpuSuspended(() => withSchedulerCpuSuspended(() => second.promise))
    ]);
    completed = true;
  });
  await tick(); first.resolve(); await tick(); assert.equal(completed, false);
  second.resolve(); await parallel;
  const original = new Error('primary wait error');
  await assert.rejects(scheduler.schedule('cpu', { cpu: 1, signal }, () =>
    withSchedulerCpuSuspended(async () => { throw original; })), error => error === original);
  const child = createSchedulerQueueAdapter({ scheduler, queueName: 'child', tokens: { mem: 1 }, concurrency: 1 });
  await scheduler.schedule('cpu', { cpu: 1, signal }, () => withSchedulerCpuSuspended(() =>
    child.add(async () => { assert.ok(scheduler.stats().tokens.cpu.used <= 2); }, { cpu: 1, signal })));
} finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }

// Optional nested work declines instead of queueing behind its parent's retained
// bytes/memory; caller compute resumes before its ordinary inline fallback.
const bounded = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
try {
  await bounded.schedule('parent', { cpu: 1, mem: 1, bytes: 100, signal }, async () => {
    const declined = await withSchedulerCpuSuspended(() => bounded.scheduleIfAvailable('optional', {
      cpu: 1, mem: 1, bytes: 100, signal
    }, () => assert.fail('nested job cannot fit')));
    assert.equal(declined, null); assert.equal(bounded.stats().tokens.cpu.used, 1);
    assert.equal(bounded.stats().queues.optional.pending, 0);
  });
  assert.equal(await bounded.scheduleIfAvailable('optional', { cpu: 1, mem: 1, bytes: 100, signal }, () => 7), 7);
} finally { await bounded.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }

// Suspended files do not turn the CPU queue into an unbounded retained window.
const windowed = createBuildScheduler({ cpuTokens: 1, queues: { cpu: { concurrency: 1, maxPending: 1 } } });
const retainedGate = deferred(); let retained = 0;
const held = [1, 2].map(() => windowed.schedule('cpu', { cpu: 1, signal }, () =>
  withSchedulerCpuSuspended(async () => { retained++; await retainedGate.promise; })));
await until(() => retained === 2);
const third = windowed.schedule('cpu', { cpu: 1, signal }, () => 3);
await assert.rejects(windowed.schedule('cpu', { cpu: 1, signal }, () => 4), /maxPending/);
assert.equal(windowed.stats().queues.cpu.retainedRunning, 2);
assert.equal(windowed.stats().queues.cpu.blockedBy['retained-file-window'], 1);
retainedGate.resolve(); await Promise.all([...held, third]);
await windowed.shutdown({ awaitRunning: true, timeoutMs: 1000 });

// Cancellation preserves the original wait failure even if shutdown refuses CPU
// reacquisition. Retained reservations retire with the actual parent task.
const ending = createBuildScheduler({ cpuTokens: 1, requireSignals: true });
const controller = new AbortController(); const endGate = deferred(); const primary = new Error('original abort evidence');
const pending = ending.schedule('parent', { cpu: 1, bytes: 10, signal: controller.signal }, () =>
  withSchedulerCpuSuspended(async () => { await endGate.promise; throw primary; }));
const rejected = assert.rejects(pending, error => error === primary
  && error.cpuReacquisitionError?.code === 'ERR_SCHEDULER_CPU_REACQUIRE'
  && /shut down/.test(error.cpuReacquisitionError?.cause?.message));
await tick(); controller.abort(); ending.shutdown(); endGate.resolve(); await rejected; await tick();
assert.equal(ending.stats().tokens.cpu.used, 0); assert.equal(ending.stats().activity.inFlightBytes, 0);
