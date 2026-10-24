import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';

for (const enabled of [true, false]) {
  const scheduler = createBuildScheduler({ enabled, cpuTokens: 8, ioTokens: 8, memoryTokens: 8,
    queues: { shared: { concurrency: 1 } } });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const first = createSchedulerQueueAdapter({ scheduler, queueName: 'shared', concurrency: 4,
      queueConfig: { concurrency: 7 }, tokens: { cpu: 1 } });
    const second = createSchedulerQueueAdapter({ scheduler, queueName: 'shared', concurrency: 6, tokens: { cpu: 1 } });
    let started = 0;
    const work = Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).add(async () => {
      started++; await gate;
    }));
    await tick();
    assert.equal(started, 1, 'adapter defaults preserve the pre-existing scheduler hard cap');
    assert.equal(first.concurrency, 1); assert.equal(second.concurrency, 1);
    assert.equal(scheduler.stats().queues.shared.configuredConcurrency, 1);
    assert.equal(scheduler.stats().queues.shared.adapterConcurrency, 4);
    scheduler.registerQueue('shared', { concurrency: 8 });
    await tick(); assert.equal(started, 4, 'a configured increase still intersects both producer limits');
    first.concurrency = 2;
    second.concurrency = 8;
    assert.equal(first.concurrency, 2); assert.equal(second.concurrency, 2);
    assert.equal(scheduler.stats().queues.shared.concurrency, 2);
    first.concurrency = 5;
    await tick(); assert.equal(started, 5, 'only this producer owner changes its own cap');
    scheduler.registerQueue('shared', { concurrency: 0 });
    assert.equal(first.concurrency, 5, 'clearing the configured cap preserves producer ceilings');
    second.concurrency = 3;
    assert.equal(first.concurrency, 3);
    release(); await Promise.all(work); await first.onIdle(); await second.onIdle();
    assert.equal(scheduler.stats().tokens.cpu.used, 0);
    first.concurrency = 20;
    second.concurrency = 20;
    assert.equal(first.concurrency, 7, 'explicit adapter configuration remains a separate ceiling');
  } finally { release(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
}
console.log('shared adapters preserve independent scheduler and producer concurrency authority');
