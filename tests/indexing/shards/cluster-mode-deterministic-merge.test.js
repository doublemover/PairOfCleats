#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildDeterministicShardMergePlan,
  resolveShardSubsetId
} from '../../../src/index/build/indexer/steps/process-files.js';
import { buildShardConfig } from '../../../src/index/build/runtime/config.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const makeWorkItem = ({ shardId, orderIndexes, partIndex = 1, partTotal = 1 }) => ({
  shard: { id: shardId, label: shardId },
  partIndex,
  partTotal,
  entries: (orderIndexes || []).map((orderIndex, i) => ({
    rel: `${shardId}-${partIndex}-${i}.js`,
    orderIndex
  }))
});

const workItems = [
  makeWorkItem({ shardId: 'shard-c', orderIndexes: [40] }),
  makeWorkItem({ shardId: 'shard-b', orderIndexes: [30], partIndex: 2, partTotal: 2 }),
  makeWorkItem({ shardId: 'shard-a', orderIndexes: [10] }),
  makeWorkItem({ shardId: 'shard-b', orderIndexes: [20], partIndex: 1, partTotal: 2 })
];

const mergePlan = buildDeterministicShardMergePlan(workItems);
assert.equal(mergePlan.length, 4, 'expected one merge record per shard subset');
assert.deepEqual(
  mergePlan.map((entry) => entry.subsetId),
  [
    resolveShardSubsetId(workItems[2]),
    resolveShardSubsetId(workItems[3]),
    resolveShardSubsetId(workItems[1]),
    resolveShardSubsetId(workItems[0])
  ],
  'merge plan should be stable by order index then shard id then part index'
);
assert.deepEqual(
  mergePlan.map((entry) => entry.mergeIndex),
  [1, 2, 3, 4],
  'merge indexes should be contiguous and deterministic'
);
assert.deepEqual(
  mergePlan.map((entry) => entry.firstOrderIndex),
  [10, 20, 30, 40],
  'merge plan should preserve first order index per subset'
);

const clusterConfig = buildShardConfig({
  shards: {
    enabled: false
  },
  clusterMode: {
    enabled: true,
    workerCount: 3,
    deterministicMerge: true,
    maxSubsetRetries: 2,
    retryDelayMs: 25
  }
});
assert.equal(clusterConfig.enabled, true, 'cluster mode should force shard mode enabled');
assert.equal(clusterConfig.cluster.enabled, true, 'cluster config should be enabled');
assert.equal(clusterConfig.cluster.workerCount, 3, 'cluster worker count should be applied');
assert.equal(clusterConfig.cluster.deterministicMerge, true, 'deterministic merge should be enabled');
assert.equal(clusterConfig.cluster.mergeOrder, 'stable', 'cluster merge mode should be stable');
assert.equal(clusterConfig.cluster.maxSubsetRetries, 2, 'subset retry max should be normalized');
assert.equal(clusterConfig.cluster.retryDelayMs, 25, 'subset retry delay should be normalized');

console.log('cluster mode deterministic merge test passed');
