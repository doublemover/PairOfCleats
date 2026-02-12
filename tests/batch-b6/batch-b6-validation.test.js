#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B6',
  laneId: 'batch-b6',
  expectedOrderIds: ['batch-b6/batch-b6-validation']
});

console.log('batch-b6 shard checks passed');
