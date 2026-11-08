import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createFileSerialCompute } from '../../../src/index/build/file-processor/serial-compute.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { currentSchedulerTaskLease } from '../../../src/shared/concurrency/scheduler-task-scope.js';

// AUTHORED: actual file parser-chain owner, no native parser execution required.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'fifo';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check()); };
const scheduler = createBuildScheduler({ cpuTokens: 2, maxInFlightBytes: 1000,
  queues: { file: { concurrency: 2, maxPending: 4 } } });
const serial = createFileSerialCompute(), head = deferred(), events = [];
const controller = new AbortController();
const first = scheduler.schedule('file', { cpu: 1, bytes: 100 }, () => serial(async () => {
  events.push('first'); await head.promise;
}));
let secondRan = false;
const second = scheduler.schedule('file', { cpu: 1, bytes: 100, signal: controller.signal }, () => serial(() => {
  secondRan = true; events.push('second'); assert.equal(currentSchedulerTaskLease().used.cpu, 1);
}));
try {
  await until(() => scheduler.stats().queues.file.suspendedCpu === 1);
  assert.equal(scheduler.stats().tokens.cpu.used, 1, 'only executing parser head owns compute');
  assert.equal(scheduler.stats().activity.inFlightBytes, 200, 'queued parser retains bounded file/source ownership');
  await scheduler.schedule('ready', { cpu: 1, bytes: 50 }, () => events.push('ready'));
  assert.deepEqual(events, ['first', 'ready'], 'unrelated admitted compute can run while parser predecessor is blocked');
  if (selected === 'cancel') {
    const failed = assert.rejects(second, { name: 'AbortError' }); controller.abort();
    const third = scheduler.schedule('file', { cpu: 1, bytes: 100 }, () => serial(() => events.push('third')));
    await until(() => scheduler.stats().queues.file.suspendedCpu === 2);
    head.resolve(); await Promise.all([first, failed, third]);
    assert.equal(secondRan, false); assert.deepEqual(events, ['first', 'ready', 'third']);
  } else if (selected === 'shutdown') {
    const failed = assert.rejects(second, { code: 'ERR_SCHEDULER_CPU_REACQUIRE' });
    const shutdown = scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
    assert.equal(scheduler.stats().activity.inFlightBytes, 200);
    head.resolve(); await Promise.all([first, failed, shutdown]);
    assert.equal(secondRan, false);
  } else {
    head.resolve(); await Promise.all([first, second]);
    assert.deepEqual(events, ['first', 'ready', 'second']);
    const failure = new Error('parser failed');
    await assert.rejects(scheduler.schedule('file', { cpu: 1, bytes: 100 }, () => serial(() => { throw failure; })), error => error === failure);
    await scheduler.schedule('file', { cpu: 1, bytes: 100 }, () => serial(() => events.push('after-failure')));
    assert.equal(events.at(-1), 'after-failure', 'parser rejection does not poison FIFO owner');
  }
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
} finally {
  head.resolve(); await Promise.allSettled([first, second]); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log(`file parser serial wait ${selected} ownership control authored`);
