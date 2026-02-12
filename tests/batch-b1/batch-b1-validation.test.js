#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B1',
  laneId: 'batch-b1',
  expectedOrderIds: ['batch-b1/batch-b1-validation']
});

console.log('batch-b1 shard checks passed');
