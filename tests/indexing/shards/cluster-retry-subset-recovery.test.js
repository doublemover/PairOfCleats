#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveShardSubsetId,
  runShardSubsetsWithRetry
} from '../../../src/index/build/indexer/steps/process-files.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const makeWorkItem = (shardId, orderIndex) => ({
  shard: { id: shardId, label: shardId },
  partIndex: 1,
  partTotal: 1,
  entries: [{ rel: `${shardId}.js`, orderIndex }]
});

const workItems = [
  makeWorkItem('shard-a', 1),
  makeWorkItem('shard-b', 2),
  makeWorkItem('shard-c', 3)
];
const flakySubsetId = resolveShardSubsetId(workItems[1]);
const attemptsBySubset = new Map();
const retryEvents = [];

const retryResult = await runShardSubsetsWithRetry({
  workItems,
  maxSubsetRetries: 2,
  retryDelayMs: 0,
  executeWorkItem: async (workItem, context) => {
    const subsetId = resolveShardSubsetId(workItem);
    const nextAttempt = (attemptsBySubset.get(subsetId) || 0) + 1;
    attemptsBySubset.set(subsetId, nextAttempt);
    if (subsetId === flakySubsetId && nextAttempt === 1) {
      throw new Error(`transient failure for ${subsetId}`);
    }
    assert.equal(context.subsetId, subsetId, 'retry context subset id should match work item');
  },
  onRetry: (event) => {
    retryEvents.push(event);
  }
});

assert.equal(attemptsBySubset.get(resolveShardSubsetId(workItems[0])), 1, 'subset A should run once');
assert.equal(attemptsBySubset.get(flakySubsetId), 2, 'failed subset should retry once');
assert.equal(attemptsBySubset.get(resolveShardSubsetId(workItems[2])), 1, 'subset C should run once');
assert.deepEqual(retryResult.retriedSubsetIds, [flakySubsetId], 'only failed subset should be retried');
assert.deepEqual(retryResult.recoveredSubsetIds, [flakySubsetId], 'failed subset should recover after retry');
assert.equal(retryEvents.length, 1, 'expected one retry callback');
assert.equal(retryEvents[0]?.subsetId, flakySubsetId, 'retry callback should report failed subset id');

const fatalSubsetId = resolveShardSubsetId(workItems[2]);
await assert.rejects(
  () => runShardSubsetsWithRetry({
    workItems,
    maxSubsetRetries: 1,
    retryDelayMs: 0,
    executeWorkItem: async (workItem) => {
      const subsetId = resolveShardSubsetId(workItem);
      if (subsetId === fatalSubsetId) {
        throw new Error(`fatal failure for ${subsetId}`);
      }
    }
  }),
  (err) => {
    assert.equal(err?.shardSubsetId, fatalSubsetId, 'fatal error should include failed subset id');
    assert.equal(err?.shardSubsetAttempt, 2, 'fatal subset should stop after max attempts');
    assert.equal(err?.shardSubsetMaxAttempts, 2, 'fatal subset should report max attempts');
    return true;
  }
);

console.log('cluster retry subset recovery test passed');
