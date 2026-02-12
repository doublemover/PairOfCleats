#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B5',
  laneId: 'batch-b5',
  expectedOrderIds: ['batch-b5/batch-b5-validation']
});

console.log('batch-b5 shard checks passed');
