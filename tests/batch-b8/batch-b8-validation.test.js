#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B8',
  laneId: 'batch-b8',
  expectedOrderIds: ['batch-b8/batch-b8-validation']
});

console.log('batch-b8 shard checks passed');
