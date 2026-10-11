#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveStage1Queues } from '../../../src/index/build/runtime/queues.js';
import { resolveOrderedAppenderConfig, resolvePostingsQueueConfig } from '../../../src/index/build/indexer/steps/process-files/planner.js';
import { buildContiguousSeqWindows, resolveStage1WindowPlannerConfig } from '../../../src/index/build/indexer/steps/process-files/ordering.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const resolveRuntime = (stage1 = {}) => ({
  stage1Queues: resolveStage1Queues({ stage1 }),
  fileConcurrency: 8,
  cpuConcurrency: 8
});

for (const absent of [undefined, null]) {
  const runtime = resolveRuntime({
    postings: { maxHeapFraction: absent },
    ordered: { resumeHysteresisRatio: absent },
    window: { commitLagSoft: absent }
  });
  const postings = createPostingsQueue(resolvePostingsQueueConfig(runtime));
  assert.equal(postings.stats().limits.maxHeapFraction, 0.8, 'unset survives resolver and planner to retain the queue heap guard');
  assert.equal(resolveOrderedAppenderConfig(runtime).resumeHysteresisRatio, 0.7, 'unset retains ordered resume policy');
  const windows = resolveStage1WindowPlannerConfig(runtime);
  assert.equal(windows.commitLagSoft, 64, 'unset retains CPU-scaled lag threshold');
  const entries = Array.from({ length: 16 }, (_, orderIndex) => ({ orderIndex, costMs: 400, bytes: 1 }));
  const planned = buildContiguousSeqWindows(entries, {
    config: windows,
    telemetrySnapshot: { commitLag: 1, bufferedBytes: 0, computeUtilization: 0.8 }
  });
  assert.equal(planned[0].entryCount, 10, 'ordinary one-file lag must not shrink the default cost window');
}

const zero = resolveRuntime({ postings: { maxHeapFraction: 0 }, window: { commitLagSoft: 0 } });
assert.equal(createPostingsQueue(resolvePostingsQueueConfig(zero)).stats().limits.maxHeapFraction, 0);
assert.equal(resolveStage1WindowPlannerConfig(zero).commitLagSoft, 0, 'explicit zero remains an immediate adaptive threshold');
const custom = resolveRuntime({ postings: { maxHeapFraction: 0.6 }, ordered: { resumeHysteresisRatio: 0.4 }, window: { commitLagSoft: 5 } });
assert.equal(createPostingsQueue(resolvePostingsQueueConfig(custom)).stats().limits.maxHeapFraction, 0.6);
assert.equal(resolveOrderedAppenderConfig(custom).resumeHysteresisRatio, 0.4);
assert.equal(resolveStage1WindowPlannerConfig(custom).commitLagSoft, 5);

for (const applied of [false, true]) {
  for (const limits of [
    { maxPendingRows: 2, maxPendingBytes: 1024 },
    { maxPendingRows: 1000, maxPendingBytes: 32 * 1024 * 1024 }
  ]) {
    const runtime = {
      ...resolveRuntime({ postings: { ...limits, maxHeapFraction: 0 } }),
      memoryPolicy: { highMemoryProfile: { applied, postingsScale: 2 } }
    };
    const resolved = resolvePostingsQueueConfig(runtime);
    const queue = createPostingsQueue(resolved);
    assert.equal(queue.stats().limits.maxPendingRows, limits.maxPendingRows);
    assert.equal(queue.stats().limits.maxPendingBytes, limits.maxPendingBytes);
    for (const dimension of ['rows', 'bytes']) {
      const first = await queue.reserve({ rows: dimension === 'rows' ? limits.maxPendingRows : 1,
        bytes: dimension === 'bytes' ? limits.maxPendingBytes : 1 });
      const controller = new AbortController();
      let started = false;
      const blocked = queue.reserve({ rows: 1, bytes: 1, signal: controller.signal }).then(reservation => {
        started = true;
        reservation.release();
      });
      const rejected = assert.rejects(blocked, { name: 'AbortError' });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(started, false, `explicit ${dimension} cap is enforced at admission`);
      controller.abort();
      await rejected;
      first.release();
      assert.equal(queue.stats().pending.count, 0, 'cancel/release returns accounting to zero');
    }
    const oversize = await queue.reserve({ rows: limits.maxPendingRows + 1, bytes: limits.maxPendingBytes + 1 });
    oversize.release();
    assert.equal(queue.stats().pending.count, 0, 'single oversized payload escape hatch still completes');
  }
}
const base = resolvePostingsQueueConfig(resolveRuntime());
const scaled = resolvePostingsQueueConfig({ ...resolveRuntime(), memoryPolicy: { highMemoryProfile: { applied: true, postingsScale: 2 } } });
assert.equal(scaled.maxPendingRows, base.maxPendingRows * 2, 'inferred budgets still scale');
assert.equal(scaled.maxPendingBytes, base.maxPendingBytes * 2);
console.log('Stage1 admission config handoff preserves defaults, explicit bounds and cancellation');
