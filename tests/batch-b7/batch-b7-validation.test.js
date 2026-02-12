#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B7',
  laneId: 'batch-b7',
  expectedOrderIds: ['batch-b7/batch-b7-validation']
});

console.log('batch-b7 shard checks passed');
