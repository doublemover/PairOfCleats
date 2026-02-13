#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B1',
  laneId: 'batch-javascript-typescript',
  expectedOrderIds: ['batch-javascript-typescript/batch-javascript-typescript-validation']
});

console.log('batch-javascript-typescript shard checks passed');
