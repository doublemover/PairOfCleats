#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B5',
  laneId: 'conformance-shard-markup-style-template',
  expectedOrderManifest: 'tests/conformance/language-shards/markup-style-template/markup-style-template.order.txt',
  expectedOrderIds: ['conformance/language-shards/markup-style-template/markup-style-template-validation']
});

console.log('conformance/language-shards/markup-style-template.test checks passed');
