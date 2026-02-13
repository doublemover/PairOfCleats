#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B3',
  laneId: 'conformance-shard-managed-languages',
  expectedOrderManifest: 'tests/conformance/language-shards/managed-languages/managed-languages.order.txt',
  expectedOrderIds: ['conformance/language-shards/managed-languages/managed-languages-validation']
});

console.log('conformance/language-shards/managed-languages.test checks passed');
