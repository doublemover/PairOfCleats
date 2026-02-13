#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B7',
  laneId: 'conformance-shard-build-infra-dsl',
  expectedOrderManifest: 'tests/conformance/language-shards/build-infra-dsl/build-infra-dsl.order.txt',
  expectedOrderIds: ['conformance/language-shards/build-infra-dsl/build-infra-dsl-validation']
});

console.log('conformance/language-shards/build-infra-dsl.test checks passed');
