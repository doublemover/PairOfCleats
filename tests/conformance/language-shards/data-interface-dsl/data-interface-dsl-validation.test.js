#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B6',
  laneId: 'conformance-shard-data-interface-dsl',
  expectedOrderManifest: 'tests/conformance/language-shards/data-interface-dsl/data-interface-dsl.order.txt',
  expectedOrderIds: ['conformance/language-shards/data-interface-dsl/data-interface-dsl-validation']
});

console.log('conformance/language-shards/data-interface-dsl.test checks passed');
