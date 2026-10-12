#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';
import { resolveSchedulerConfig, SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';

const names = [SCHEDULER_QUEUE_NAMES.stage1Cpu, SCHEDULER_QUEUE_NAMES.stage1Io,
  SCHEDULER_QUEUE_NAMES.embeddingsCompute, SCHEDULER_QUEUE_NAMES.stage1Proc];
for (const cap of [undefined, null, 0, 2, 64]) {
  const schedulerConfig = resolveSchedulerConfig({ indexingConfig: { scheduler: {
    adaptive: false, queues: Object.fromEntries(names.map(name => [name, cap == null ? {} : { maxPending: cap }]))
  } } });
  const scheduler = createBuildScheduler(schedulerConfig);
  const { queues } = createRuntimeQueues({ scheduler, schedulerConfig, cpuConcurrency: 8, ioConcurrency: 8,
    fileConcurrency: 8, embeddingConcurrency: 8, procConcurrency: 8,
    pendingLimits: Object.fromEntries(['cpu', 'io', 'embedding', 'proc'].map(name => [name, { maxPending: 8 }])) });
  try {
    const stats = scheduler.stats();
    for (const [index, key] of ['cpu', 'io', 'embedding', 'proc'].entries()) {
      assert.equal(stats.queues[names[index]].maxPending, cap == null ? 8 : cap === 0 ? null : cap,
        `${names[index]} preserves configured scheduler cap instead of replacing it with a default`);
      assert.equal(queues[key].maxPending, cap > 0 ? Math.min(8, cap) : 8,
        'local producer working-set bound stays independent of scheduler admission');
    }
    // Exercise the real queue consumer rather than checking a resolver alone.
    const values = await runWithQueue(queues.io, Array.from({ length: 20 }, (_, index) => index),
      async value => value, { collectResults: true });
    assert.deepEqual(values, Array.from({ length: 20 }, (_, index) => index));
    await queues.io.onIdle();
    assert.equal(scheduler.stats().counters.rejectedByReason.maxPending, 0, 'producer backpressure prevents cap rejection');
  } finally { await scheduler.shutdown({ awaitRunning: true }); }
}
console.log('runtime queue construction preserves scheduler overrides and bounded producer windows');
