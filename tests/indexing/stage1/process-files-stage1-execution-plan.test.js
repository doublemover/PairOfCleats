#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  assignFileIndexes,
  createStage1ProgressTracker,
  resolveOrderedEntryProgressPlan,
  resolveStage1ShardExecutionQueuePlan
} from '../../../src/index/build/indexer/steps/process-files/stage1-execution-plan.js';

ensureTestingEnv(process.env);

const entries = [
  { rel: 'a.js', orderIndex: 9 },
  null,
  { rel: 'b.js', canonicalOrderIndex: 3 },
  { rel: 'c.js' }
];
assignFileIndexes(entries);
assert.equal(entries[0].fileIndex, 1, 'expected first entry to be assigned index 1');
assert.equal(entries[2].fileIndex, 3, 'expected file index assignment to stay position-based');
assert.equal(entries[3].fileIndex, 4, 'expected file index assignment to include sparse/null slots');

const orderedPlan = resolveOrderedEntryProgressPlan(entries);
assert.equal(orderedPlan.startOrderIndex, 3, 'expected minimum explicit order index as start index');
assert.deepEqual(orderedPlan.expectedOrderIndices, [3, 9], 'expected deduped sorted expected order indices');

const progressEvents = [];
const checkpoint = {
  tick: () => {
    progressEvents.push('checkpoint');
  }
};
const tracker = createStage1ProgressTracker({
  total: 4,
  mode: 'code',
  checkpoint,
  onTick: (count) => {
    progressEvents.push(`tick:${count}`);
  },
  showProgressFn: () => {}
});
const shardProgress = {
  count: 0,
  total: 2,
  meta: {}
};
assert.equal(tracker.markOrderedEntryComplete(5, shardProgress), true, 'expected first completion to advance');
assert.equal(tracker.markOrderedEntryComplete(5, shardProgress), false, 'expected duplicate order index to be ignored');
assert.equal(tracker.markOrderedEntryComplete(null, null), true, 'expected null order index events to still progress');
assert.equal(tracker.progress.count, 2, 'expected progress count to match accepted completion events');
assert.equal(shardProgress.count, 1, 'expected shard progress to advance only once');
assert.deepEqual(
  progressEvents,
  ['tick:1', 'checkpoint', 'tick:2', 'checkpoint'],
  'expected onTick/checkpoint hooks for each accepted progress update'
);

const shardPlan = [
  {
    id: 'shard-b',
    label: 'shard-b',
    entries: [{ rel: 'b1.js', orderIndex: 10 }, { rel: 'b2.js', orderIndex: 11 }],
    lineCount: 200,
    byteCount: 2000,
    costMs: 200
  },
  {
    id: 'shard-a',
    label: 'shard-a',
    entries: [
      { rel: 'a1.js', orderIndex: 1 },
      { rel: 'a2.js', orderIndex: 2 },
      { rel: 'a3.js', orderIndex: 3 }
    ],
    lineCount: 600,
    byteCount: 6000,
    costMs: 600
  }
];
const shardQueuePlan = resolveStage1ShardExecutionQueuePlan({
  shardPlan,
  runtime: {
    fileConcurrency: 8,
    cpuConcurrency: 8,
    importConcurrency: 4,
    embeddingConcurrency: 6,
    shards: {
      maxWorkers: 2,
      cluster: {
        workerCount: 2
      }
    }
  },
  clusterModeEnabled: true,
  clusterDeterministicMerge: true
});
assert.equal(
  shardQueuePlan.shardExecutionPlan[0]?.id,
  'shard-a',
  'expected deterministic shard execution ordering by shard id in cluster mode'
);
assert.equal(shardQueuePlan.shardExecutionOrderById.get('shard-a'), 1, 'expected shard-a execution order');
assert.equal(shardQueuePlan.shardExecutionOrderById.get('shard-b'), 2, 'expected shard-b execution order');
assert.deepEqual(
  shardQueuePlan.totals,
  { totalFiles: 5, totalLines: 800, totalBytes: 8000, totalCost: 800 },
  'expected aggregate shard totals to include files/lines/bytes/cost'
);
assert.ok(
  shardQueuePlan.shardWorkPlan.length > shardPlan.length,
  'expected heavy shards to split into multiple deterministic work items'
);
assert.equal(
  shardQueuePlan.shardMergePlan.length,
  shardQueuePlan.shardWorkPlan.length,
  'expected one merge record per shard work item'
);
assert.deepEqual(
  shardQueuePlan.shardMergePlan.map((entry) => entry.mergeIndex),
  Array.from({ length: shardQueuePlan.shardMergePlan.length }, (_, i) => i + 1),
  'expected contiguous deterministic merge indexes'
);
for (const workItem of shardQueuePlan.shardWorkPlan) {
  assert.equal(typeof workItem.subsetId, 'string', 'expected subset ids on shard work items');
  assert.ok(Number.isFinite(workItem.firstOrderIndex), 'expected first order index on shard work item');
  assert.ok(Number.isFinite(workItem.mergeIndex), 'expected merge index projection on shard work item');
}

console.log('process-files stage1 execution plan helper test passed');
