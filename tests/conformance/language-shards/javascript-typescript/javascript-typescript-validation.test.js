#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B1',
  laneId: 'conformance-shard-javascript-typescript',
  expectedOrderManifest: 'tests/conformance/language-shards/javascript-typescript/javascript-typescript.order.txt',
  expectedOrderIds: ['conformance/language-shards/javascript-typescript/javascript-typescript-validation']
});

console.log('conformance/language-shards/javascript-typescript.test checks passed');
