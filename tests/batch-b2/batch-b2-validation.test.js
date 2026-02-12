#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B2',
  laneId: 'batch-b2',
  expectedOrderIds: ['batch-b2/batch-b2-validation']
});

console.log('batch-b2 shard checks passed');
