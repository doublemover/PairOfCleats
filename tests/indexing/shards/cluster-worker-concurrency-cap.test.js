#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  clampShardConcurrencyToRuntime,
  sortShardBatchesByDeterministicMergeOrder
} from '../../../src/index/build/indexer/steps/process-files.js';

assert.equal(
  clampShardConcurrencyToRuntime(
    { fileConcurrency: 16, cpuConcurrency: 8, importConcurrency: 6 },
    32
  ),
  6,
  'expected shard worker concurrency to respect file/cpu/import caps'
);

assert.equal(
  clampShardConcurrencyToRuntime(
    { fileConcurrency: 12, cpuConcurrency: 4, importConcurrency: 9 },
    2
  ),
  2,
  'expected explicit worker count below caps to be preserved'
);

assert.equal(
  clampShardConcurrencyToRuntime(
    { fileConcurrency: null, cpuConcurrency: undefined, importConcurrency: null },
    7
  ),
  7,
  'expected no-op when runtime caps are unavailable'
);

const batchA = [{ firstOrderIndex: 30, mergeIndex: 5, shard: { id: 'shard-c' } }];
const batchB = [{ firstOrderIndex: 10, mergeIndex: 4, shard: { id: 'shard-b' } }];
const batchC = [{ firstOrderIndex: 10, mergeIndex: 2, shard: { id: 'shard-a' } }];

const sorted = sortShardBatchesByDeterministicMergeOrder([batchA, batchB, batchC]);
assert.deepEqual(
  sorted.map((batch) => batch[0]?.shard?.id),
  ['shard-a', 'shard-b', 'shard-c'],
  'expected deterministic batch ordering by order index, merge index, then shard id'
);

console.log('cluster worker concurrency cap test passed');
