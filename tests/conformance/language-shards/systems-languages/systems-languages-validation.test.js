#!/usr/bin/env node
import { assertLanguageShardDefinition } from '../assert-language-shard.js';

assertLanguageShardDefinition({
  shardId: 'B2',
  laneId: 'conformance-shard-systems-languages',
  expectedOrderManifest: 'tests/conformance/language-shards/systems-languages/systems-languages.order.txt',
  expectedOrderIds: ['conformance/language-shards/systems-languages/systems-languages-validation']
});

console.log('systems language shard validation passed');
