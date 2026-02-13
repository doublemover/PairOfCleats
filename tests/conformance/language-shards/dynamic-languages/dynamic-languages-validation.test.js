#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B4',
  laneId: 'conformance-shard-dynamic-languages',
  expectedOrderManifest: 'tests/conformance/language-shards/dynamic-languages/dynamic-languages.order.txt',
  expectedOrderIds: ['conformance/language-shards/dynamic-languages/dynamic-languages-validation']
});

console.log('conformance/language-shards/dynamic-languages.test checks passed');
