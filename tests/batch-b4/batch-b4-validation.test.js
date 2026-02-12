#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B4',
  laneId: 'batch-b4',
  expectedOrderIds: ['batch-b4/batch-b4-validation']
});

console.log('batch-b4 shard checks passed');
