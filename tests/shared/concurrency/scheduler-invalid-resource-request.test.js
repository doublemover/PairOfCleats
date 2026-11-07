import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';

for (const enabled of [true, false]) {
  const scheduler = createBuildScheduler({ enabled, cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
  try {
    let executed = 0;
    let rejected = 0;
    for (const kind of ['cpu', 'io', 'mem', 'bytes']) {
      for (const value of [NaN, Infinity, -Infinity, 'invalid', Number.MAX_SAFE_INTEGER + 1, Symbol('count')]) {
        await assert.rejects(scheduler.schedule('invalid', { [kind]: value }, () => executed++),
          error => error.code === 'ERR_SCHEDULER_RESOURCE_REQUEST' && error.resource === kind);
        rejected++;
        await assert.rejects(scheduler.scheduleIfAvailable('invalid', { [kind]: value }, () => executed++),
          { code: 'ERR_SCHEDULER_RESOURCE_REQUEST' });
        rejected++;
      }
    }
    assert.equal(executed, 0, 'malformed claims never dispatch uncharged compute');
    assert.equal(scheduler.stats().activity.pending, 0, 'unstartable claims never poison the queue');
    assert.equal(scheduler.stats().counters.rejectedByReason.invalidRequest, rejected);
    assert.equal(await scheduler.schedule('valid', { cpu: '1', bytes: '10' }, () => 7), 7);
    const queue = createSchedulerQueueAdapter({ scheduler, queueName: 'adapter', tokens: { cpu: 1 },
      concurrency: 1, maxPending: 1, backpressure: true });
    for (const override of [{ bytes: NaN }, { bytes: Infinity }, { cpu: NaN }, { cpu: Infinity }]) {
      await assert.rejects(queue.add(() => assert.fail('invalid adapter override dispatched'), override),
        { code: 'ERR_SCHEDULER_RESOURCE_REQUEST' });
    }
    assert.equal(await queue.add(() => 8), 8);
    await queue.onIdle();
    assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  } finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
}
console.log('scheduler and producer adapters reject malformed resource claims before admission');
