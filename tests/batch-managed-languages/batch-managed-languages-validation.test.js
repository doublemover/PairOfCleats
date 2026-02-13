#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B3',
  laneId: 'batch-managed-languages',
  expectedOrderIds: ['batch-managed-languages/batch-managed-languages-validation']
});

console.log('batch-managed-languages shard checks passed');
