import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../src/shared/concurrency/queue-adapter.js';
for (const [queueName, tokens] of [['stage1.cpu', { cpu: 1 }], ['stage1.io', { io: 1 }],
  ['stage1.proc', { mem: 1 }], ['embeddings.compute', { mem: 1 }]]) {
  for (const enabled of [true, false]) {
    const scheduler = createBuildScheduler({ enabled, cpuTokens: 8, ioTokens: 8, memoryTokens: 8,
      adaptive: { enabled: false } });
    const adapter = createSchedulerQueueAdapter({ scheduler, queueName, tokens, concurrency: 2, maxPending: 32 });
    let started = 0, release;
    const held = new Promise(resolve => { release = resolve; });
    const jobs = Array.from({ length: 8 }, () => adapter.add(async () => { started += 1; await held; }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 2, `${queueName} scheduler=${enabled}`);
    assert.equal(scheduler.stats().queues[queueName].concurrency, 2);
    release(); await Promise.all(jobs); await adapter.onIdle();
    await scheduler.shutdown({ awaitRunning: true });
  }
}
console.log('scheduler adapter hard concurrency passed');
