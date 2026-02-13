#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B2',
  laneId: 'batch-systems-languages',
  expectedOrderIds: ['batch-systems-languages/batch-systems-languages-validation']
});

console.log('batch-systems-languages shard checks passed');
