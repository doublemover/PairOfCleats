import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';
import { withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const build = (scheduler, extra = {}) => createRuntimeQueues({ ioConcurrency: 2, cpuConcurrency: 2,
  fileConcurrency: 2, embeddingConcurrency: 2, procConcurrency: 2, pendingLimits: {}, scheduler, ...extra }).queues;
for (const enabled of [true, false]) for (const adaptive of [true, false]) for (const global of [1, 8]) {
  const scheduler = createBuildScheduler({ enabled, adaptive, cpuTokens: global, ioTokens: global,
    memoryTokens: global, maxCpuTokens: global, maxIoTokens: global, maxMemoryTokens: global });
  const queues = build(scheduler), finish = gate();
  try {
    for (const kind of ['cpu', 'io', 'proc', 'embedding']) {
      let started = 0, settled = false;
      const work = Array.from({ length: 8 }, () => queues[kind].add(async () => { started++; await finish.promise; }));
      work.forEach(promise => promise.catch(() => {}));
      await tick();
      assert.equal(started, enabled ? Math.min(2, global) : 2, `${kind}: actual runtime adapter/PQueue admission`);
      const idle = queues[kind].onIdle().then(() => { settled = true; });
      await tick(); assert.equal(settled, false);
      finish.resolve(); await Promise.all(work); await idle;
      // Each queue needs a fresh gate; repeat the held positive independently.
      if (kind !== 'embedding') {
        finish.promise = new Promise(resolve => { finish.resolve = resolve; });
      }
    }
  } finally { finish.resolve(); await scheduler.shutdown({ awaitRunning: true }); }
}
const scheduler = createBuildScheduler({ cpuTokens: 8, ioTokens: 8, memoryTokens: 8 });
try {
  const queues = build(scheduler, { stage1Queues: { tokenize: { concurrency: 1 } } });
  assert.equal(queues.cpu.concurrency, 1, 'explicit tokenize cap reaches the actual runtime queue owner');
  for (const outcome of ['clear', 'queued-abort', 'active-abort', 'rejection', 'shutdown']) {
    const owned = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1 });
    const queue = build(owned, { ioConcurrency: 1, pendingLimits: { io: { maxPending: 1 } } }).io;
    const finish = gate(), started = gate(), controller = new AbortController(), failure = new Error('original task rejection');
    let activeSettled = false, idleSettled = false;
    const active = queue.add(async () => { started.resolve(); await finish.promise;
      if (outcome === 'active-abort' || outcome === 'rejection') throw failure;
      return 7;
    }, { signal: controller.signal, bytes: 10 });
    active.then(() => { activeSettled = true; }, () => { activeSettled = true; });
    await started.promise;
    const queuedController = new AbortController();
    const queued = queue.add(() => 8, { signal: queuedController.signal, bytes: 10 }); queued.catch(() => {});
    const idle = queue.onIdle().then(() => { idleSettled = true; });
    let shutdown;
    if (outcome === 'clear') queue.clear();
    if (outcome === 'queued-abort') queuedController.abort();
    if (outcome === 'active-abort') controller.abort();
    if (outcome === 'shutdown') shutdown = owned.shutdown({ awaitRunning: true });
    await tick(); assert.equal(activeSettled, false); assert.equal(idleSettled, false);
    assert.equal(owned.stats().tokens.io.used, 1, 'caller events cannot release running work before original settlement');
    finish.resolve();
    if (outcome === 'active-abort' || outcome === 'rejection') await assert.rejects(active, error => error === failure);
    else assert.equal(await active, 7);
    const result = await Promise.allSettled([queued]);
    assert.equal(result[0].status, ['clear', 'queued-abort', 'shutdown'].includes(outcome) ? 'rejected' : 'fulfilled');
    await idle; if (shutdown) await shutdown;
    assert.equal(owned.stats().tokens.io.used, 0); assert.equal(owned.stats().runningTasks, 0);
    await owned.shutdown({ awaitRunning: true });
  }
} finally { await scheduler.shutdown({ awaitRunning: true }); }
const nested = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1 });
try {
  const queues = build(nested, { cpuConcurrency: 1, ioConcurrency: 1, procConcurrency: 1, embeddingConcurrency: 1 });
  await queues.cpu.add(() => withSchedulerCpuSuspended(async () => {
    await queues.io.add(() => 1); await queues.proc.add(() => 2); await queues.embedding.add(() => 3);
  }));
  await Promise.all(Object.values(queues).map(queue => queue.onIdle()));
} finally { await nested.shutdown({ awaitRunning: true }); }
console.log('Actual runtime queues retain hard caps, cancellation/clear/shutdown ownership, idle accounting and one-slot nested progress.');
