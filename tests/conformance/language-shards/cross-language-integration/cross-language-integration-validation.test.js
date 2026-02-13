#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B8',
  laneId: 'conformance-shard-cross-language-integration',
  expectedOrderManifest: 'tests/conformance/language-shards/cross-language-integration/cross-language-integration.order.txt',
  expectedOrderIds: ['conformance/language-shards/cross-language-integration/cross-language-integration-validation']
});

console.log('conformance/language-shards/cross-language-integration.test checks passed');
