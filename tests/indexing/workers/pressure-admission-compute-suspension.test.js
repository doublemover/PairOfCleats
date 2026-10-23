import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';

const until = async predicate => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
  assert.ok(predicate());
};
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
let hard = true;
const queue = createWorkerPoolQueue({ maxGlobalRssBytes: 10000,
  readMemoryUsage: () => ({ heapUsed: hard ? 999 : 100, heapTotal: 1000, rss: 1000 }),
  languageThrottleConfig: { heavyLanguages: ['typescript'], blockHeavyOnHardPressure: true } });
const controller = new AbortController();
let started = false;
try {
  const task = scheduler.schedule('token-worker', { cpu: 1, mem: 1, bytes: 100, signal: controller.signal }, async () => {
    const slot = await queue.acquireLanguageThrottleSlot({ mode: 'code', languageId: 'typescript' }, { signal: controller.signal });
    try {
      started = true;
      assert.equal(scheduler.stats().tokens.cpu.used, 1, 'worker dispatch owns its compute permit');
    } finally { queue.releaseLanguageThrottleSlot(slot); }
  });
  await until(() => queue.snapshot().languageThrottle.waiting === 1);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().tokens.mem.used, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 100, 'admission keeps the retained file envelope');
  await scheduler.schedule('ready', { cpu: 1 }, () => assert.equal(started, false));
  hard = false; queue.refreshPressureAdmission();
  await task; await tick();
  assert.equal(started, true);
  assert.equal(scheduler.stats().tokens.mem.used, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  hard = true;
  const canceled = scheduler.schedule('token-worker', { cpu: 1, mem: 1, bytes: 100, signal: controller.signal }, () =>
    queue.acquireLanguageThrottleSlot({ mode: 'code', languageId: 'typescript' }, { signal: controller.signal }));
  const rejected = assert.rejects(canceled, { name: 'AbortError' });
  await until(() => queue.snapshot().languageThrottle.waiting === 1);
  controller.abort(); await rejected; await tick();
  assert.equal(queue.snapshot().languageThrottle.waiting, 0);
  assert.equal(queue.snapshot().languageThrottle.refreshTimerCount, 0);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally {
  controller.abort(); await queue.close();
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log('tokenizer admission releases CPU while retaining file memory and reacquires before worker dispatch');
