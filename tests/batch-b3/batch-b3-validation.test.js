#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B3',
  laneId: 'batch-b3',
  expectedOrderIds: ['batch-b3/batch-b3-validation']
});

console.log('batch-b3 shard checks passed');
