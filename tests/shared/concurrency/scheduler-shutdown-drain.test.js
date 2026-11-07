#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerShutdown } from '../../../src/shared/concurrency/scheduler-core/shutdown.js';

{
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1
  });
  scheduler.registerQueue('drain', { priority: 10 });

  let releaseFirst = null;
  let enterFirst;
  const firstEntered = new Promise(resolve => { enterFirst = resolve; });
  const first = scheduler.schedule('drain', { cpu: 1 }, async () => {
    enterFirst();
    return new Promise((resolve) => {
      releaseFirst = resolve;
    });
  });
  await firstEntered;
  const second = scheduler.schedule('drain', { cpu: 1 }, async () => 'second');
  const secondOutcome = second.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const shutdownPromise = scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  setTimeout(() => {
    releaseFirst?.('first');
  }, 20);
  await shutdownPromise;

  assert.equal(await first, 'first', 'expected in-flight task to finish during shutdown drain');
  const secondSettled = await secondOutcome;
  assert.equal(secondSettled?.ok, false, 'expected pending queued work to fail on shutdown');
  assert.match(
    String(secondSettled?.error?.message || ''),
    /scheduler shutdown/,
    'expected pending queued work to be rejected on shutdown'
  );
  await assert.rejects(
    () => scheduler.schedule('drain', { cpu: 1 }, async () => null),
    /shut down/,
    'expected new scheduling to be rejected after shutdown'
  );
}

{
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1
  });
  scheduler.registerQueue('timeout', { priority: 10 });

  let release = null;
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const running = scheduler.schedule('timeout', { cpu: 1 }, async () => {
    enter();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  await entered;
  const startedAt = Date.now();
  let timeout;
  await assert.rejects(scheduler.shutdown({ awaitRunning: true, timeoutMs: 25 }),
    error => { timeout = error; return error.code === 'ERR_SCHEDULER_DRAIN_TIMEOUT' && error.runningTasks === 1; });
  assert.equal(timeout.cacheOwnershipPending, true);
  assert.equal(timeout.cacheOwnershipReleased(), false, 'a timed-out waiter does not retire the original task');
  assert.throws(() => { timeout.cacheOwnershipReleased = () => true; }, TypeError,
    'rewriting diagnostics cannot replace the original retirement observation');
  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs >= 10 && elapsedMs < 500, 'expected bounded shutdown wait window');

  release?.('ok');
  assert.equal(await running, 'ok', 'expected timed-out shutdown wait to not cancel in-flight work');
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  // The public task resolves after its reservations retire, before the dispatch
  // completion promise and the first waiter's allSettled continuation finish.
  // An empty second snapshot cannot join that first snapshot's continuation.
  // Give the original completion observer its turn; do not replace it or infer
  // retirement from the successful public task alone.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timeout.cacheOwnershipReleased(), true);
}

{
  const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1 });
  scheduler.registerQueue('native-retirement', { priority: 10 });
  let physicallyRetired = false;
  const original = Object.assign(new Error('native command rejected before actual retirement'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return physicallyRetired; }
  });
  const running = scheduler.schedule('native-retirement', { cpu: 1 }, async () => { throw original; });
  const failure = await running.catch(error => error);
  assert.equal(failure.cacheOwnershipReleased(), false);
  let timeout;
  await assert.rejects(scheduler.shutdown({ awaitRunning: true, timeoutMs: 5 }), error => {
    timeout = error; return error.code === 'ERR_SCHEDULER_DRAIN_TIMEOUT';
  });
  assert.equal(timeout.cacheOwnershipReleased(), false, 'public rejection does not settle the scheduler-held native owner');
  assert.equal(scheduler.stats().runningTasks, 1);
  physicallyRetired = true;
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  assert.equal(timeout.cacheOwnershipReleased(), true); assert.equal(scheduler.stats().runningTasks, 0);
}

{
  // A bookkeeping/retirement failure can settle the dispatch promise without
  // releasing its original reservation. Promise settlement alone is insufficient.
  const task = Promise.resolve('operation settled'), originalRunning = new Set([task]);
  const state = { shuttingDown: false, runningTasks: originalRunning };
  const { shutdown } = createSchedulerShutdown({ state, config: {}, queueLifecycle: { clearAllQueues() {} } });
  let failure;
  await assert.rejects(shutdown({ awaitRunning: true }), error => {
    failure = error; return error.code === 'ERR_SCHEDULER_DRAIN_INCOMPLETE';
  });
  assert.equal(failure.cacheOwnershipReleased(), false);
  state.runningTasks = new Set();
  assert.equal(failure.cacheOwnershipReleased(), false, 'a replaced report container cannot retire the original reservation');
  originalRunning.delete(task); assert.equal(failure.cacheOwnershipReleased(), true);
}

console.log('scheduler shutdown drain test passed');
