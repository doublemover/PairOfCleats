import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';

// Authored actual scheduler/admission regression; execution is deferred.
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await tick();
  assert.ok(predicate(), 'expected bounded microtask progress');
};
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
const queue = createWorkerPoolQueue({ pressureWatermarkSoft: 0.5, pressureWatermarkHard: 0.9,
  readMemoryUsage: () => ({ heapUsed: 80, heapTotal: 100, rss: 100 }),
  languageThrottleConfig: { heavyLanguages: ['typescript'], softMaxPerLanguage: 1 } });
const payload = { mode: 'code', languageId: 'typescript' };
const controller = new AbortController();
const blockerGate = deferred(), secondGate = deferred();
const tasks = [];
let held = await queue.acquireLanguageThrottleSlot(payload);
let secondSlot = null, thirdSlot = null, blocking = false;
const order = [];
try {
  const first = scheduler.schedule('first', { cpu: 1, bytes: 100 }, () =>
    queue.acquireLanguageThrottleSlot(payload, { signal: controller.signal }));
  tasks.push(first);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => queue.snapshot().languageThrottle.waiting === 1);
  const second = scheduler.schedule('second', { cpu: 1, bytes: 100 }, async () => {
    secondSlot = await queue.acquireLanguageThrottleSlot(payload);
    order.push('second');
    try { await secondGate.promise; } finally { queue.releaseLanguageThrottleSlot(secondSlot); secondSlot = null; }
  });
  tasks.push(second);
  await until(() => queue.snapshot().languageThrottle.waiting === 2);
  const blocker = scheduler.schedule('blocker', { cpu: 1 }, async () => { blocking = true; await blockerGate.promise; });
  tasks.push(blocker);
  await until(() => blocking);
  queue.releaseLanguageThrottleSlot(held); held = null;
  await until(() => queue.snapshot().languageThrottle.waiting === 1);
  assert.equal(queue.snapshot().languageThrottle.activeByLanguage.typescript, undefined);
  assert.equal(scheduler.stats().activity.inFlightBytes, 200, 'CPU wait keeps both file reservations');
  const third = queue.acquireLanguageThrottleSlot(payload).then(slot => { thirdSlot = slot; order.push('third'); });
  tasks.push(third);
  await until(() => queue.snapshot().languageThrottle.waiting === 2);
  controller.abort();
  blockerGate.resolve(); await blocker; await rejected;
  await until(() => secondSlot !== null);
  assert.deepEqual(order, ['second'], 'abandoned delivered wake passes to the earlier waiter');
  assert.equal(queue.snapshot().languageThrottle.activeByLanguage.typescript, 1);
  secondGate.resolve(); await second; await third;
  assert.deepEqual(order, ['second', 'third']);
  queue.releaseLanguageThrottleSlot(thirdSlot); thirdSlot = null;
  assert.equal(queue.snapshot().languageThrottle.waiting, 0);
  assert.equal(queue.snapshot().languageThrottle.refreshTimerCount, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally {
  controller.abort(); blockerGate.resolve(); secondGate.resolve();
  queue.releaseLanguageThrottleSlot(held); queue.releaseLanguageThrottleSlot(secondSlot); queue.releaseLanguageThrottleSlot(thirdSlot);
  await queue.close(); await Promise.allSettled(tasks);
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log('abandoned pressure capacity wake hands off without bypassing FIFO admission');
