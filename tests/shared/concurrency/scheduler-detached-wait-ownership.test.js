import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { AsyncResource } from 'node:async_hooks';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async predicate => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
  assert.ok(predicate());
};
for (const route of ['detached', 'nested', 'timeout']) {
  const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
  const gate = deferred();
  let waitStarted = false, parentSettled = false, peerStarted = false, detached;
  const primary = new Error('outer operation failed');
  try {
    const parent = scheduler.schedule('parent', { cpu: 1, mem: 1, bytes: 100 }, async () => {
      const operation = async () => { waitStarted = true; await gate.promise; };
      if (route === 'timeout') {
        await runWithTimeout(() => withSchedulerCpuSuspended(operation), {
          timeoutMs: 10, errorFactory: () => primary
        });
      } else if (route === 'nested') {
        await withSchedulerCpuSuspended(async () => {
          detached = withSchedulerCpuSuspended(operation); detached.catch(() => {});
        });
      } else {
        detached = withSchedulerCpuSuspended(operation); detached.catch(() => {});
      }
    }).finally(() => { parentSettled = true; });
    const rejected = assert.rejects(parent, error => route === 'timeout'
      ? error === primary && error.schedulerUnawaitedWait?.code === 'ERR_SCHEDULER_UNAWAITED_WAIT'
      : error.code === 'ERR_SCHEDULER_UNAWAITED_WAIT');
    await until(() => waitStarted);
    if (route === 'timeout') await new Promise(resolve => setTimeout(resolve, 20));
    await tick();
    const peer = scheduler.schedule('peer', { cpu: 1, mem: 1, bytes: 100 }, () => { peerStarted = true; });
    await tick();
    assert.equal(parentSettled, false, 'a returned promise race does not release the original task');
    assert.equal(peerStarted, false, 'retained task memory cannot be reused before the detached operation settles');
    assert.equal(scheduler.stats().tokens.mem.used, 1);
    assert.equal(scheduler.stats().activity.inFlightBytes, 100);
    gate.resolve(); await rejected; await peer; await detached; await tick();
    assert.equal(scheduler.stats().tokens.cpu.used, 0);
    assert.equal(scheduler.stats().tokens.mem.used, 0);
    assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  } finally {
    gate.resolve(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  }
}
console.log('detached nested waits keep retained scheduler ownership until actual settlement');

// A callback can retain the suspended async context after its originating task
// settles. Borrowed suspension must reject before invoking that late operation.
{
  const scheduler = createBuildScheduler({ cpuTokens: 1 });
  let invoke, executed = 0;
  try {
    await scheduler.schedule('origin', { cpu: 1 }, () => withSchedulerCpuSuspended(async () => {
      invoke = AsyncResource.bind(() => withSchedulerCpuSuspended(async () => { executed++; }));
    }));
    await assert.rejects(invoke(), { code: 'ERR_SCHEDULER_TASK_RETIRED' });
    assert.equal(executed, 0, 'retired borrowed scope cannot launch unowned work');
    assert.equal(scheduler.stats().tokens.cpu.used, 0);
  } finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
}
