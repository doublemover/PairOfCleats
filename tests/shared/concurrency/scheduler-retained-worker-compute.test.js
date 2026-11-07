import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';

// AUTHORED actual scheduler mixed original-compute/pure-wait retention control.
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
const worker = deferred(), io = deferred();
let entered = false, readyRan = false;
const work = scheduler.schedule('file', { cpu: 1, bytes: 300 }, async () => {
  const lease = currentSchedulerTaskLease();
  lease.trackWait(() => worker.promise, { retainCpu: true });
  entered = true;
  await withSchedulerCpuSuspended(() => io.promise);
  assert.equal(lease.used.cpu, 1, 'concurrent known I/O cannot lend CPU owned by actual worker compute');
  return 'returned before worker retired';
});
const rejected = assert.rejects(work, { code: 'ERR_SCHEDULER_UNAWAITED_WAIT' });
try {
  for (let i = 0; i < 100 && !entered; i++) await tick();
  assert.equal(entered, true);
  const ready = scheduler.schedule('ready', { cpu: 1 }, () => { readyRan = true; });
  io.resolve(); await tick();
  assert.equal(readyRan, false);
  assert.equal(scheduler.stats().tokens.cpu.used, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 300);
  worker.resolve(); await rejected; await ready;
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  await scheduler.schedule('no-compute', { cpu: 0, io: 1 }, async () => {
    let invoked = false;
    await assert.rejects(currentSchedulerTaskLease().trackWait(() => { invoked = true; }, { retainCpu: true }),
      { code: 'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED' });
    assert.equal(invoked, false);
  });
} finally {
  worker.resolve(); io.resolve(); await Promise.allSettled([work]); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log('actual retained worker execution never lends its scheduler compute permit');
