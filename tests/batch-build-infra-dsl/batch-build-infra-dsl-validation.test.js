#!/usr/bin/env node
import { assertBatchShardLane } from '../batch-shards/assert-batch-shard.js';

assertBatchShardLane({
  batchId: 'B7',
  laneId: 'batch-build-infra-dsl',
  expectedOrderIds: ['batch-build-infra-dsl/batch-build-infra-dsl-validation']
});

console.log('batch-build-infra-dsl shard checks passed');
