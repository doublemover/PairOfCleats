#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B8',
  laneId: 'batch-cross-batch-integration',
  expectedOrderIds: ['batch-cross-batch-integration/batch-cross-batch-integration-validation']
});

console.log('batch-cross-batch-integration shard checks passed');
