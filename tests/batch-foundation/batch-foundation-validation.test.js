#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B0',
  laneId: 'batch-foundation',
  expectedOrderIds: ['batch-foundation/batch-foundation-validation']
});

console.log('batch-foundation shard checks passed');
