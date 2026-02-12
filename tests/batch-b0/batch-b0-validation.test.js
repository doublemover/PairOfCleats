#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B0',
  laneId: 'batch-b0',
  expectedOrderIds: ['batch-b0/batch-b0-validation']
});

console.log('batch-b0 shard checks passed');
