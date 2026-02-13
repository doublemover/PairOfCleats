#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B6',
  laneId: 'batch-data-interface-dsl',
  expectedOrderIds: ['batch-data-interface-dsl/batch-data-interface-dsl-validation']
});

console.log('batch-data-interface-dsl shard checks passed');
