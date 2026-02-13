#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B5',
  laneId: 'batch-markup-style-template',
  expectedOrderIds: ['batch-markup-style-template/batch-markup-style-template-validation']
});

console.log('batch-markup-style-template shard checks passed');
