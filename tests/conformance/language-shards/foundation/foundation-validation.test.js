#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B0',
  laneId: 'conformance-shard-foundation',
  expectedOrderManifest: 'tests/conformance/language-shards/foundation/foundation.order.txt',
  expectedOrderIds: ['conformance/language-shards/foundation/foundation-validation']
});

console.log('foundation language shard validation passed');
