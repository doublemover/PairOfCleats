#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  resolveEntryOrderIndex,
  sortEntriesByOrderIndex
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

assert.equal(resolveEntryOrderIndex({ orderIndex: 9 }, null), 9, 'expected explicit orderIndex to win');
assert.equal(resolveEntryOrderIndex({ canonicalOrderIndex: 5 }, null), 5, 'expected canonical fallback');
assert.equal(resolveEntryOrderIndex({}, 3), 3, 'expected numeric fallback index when order metadata is absent');
assert.equal(resolveEntryOrderIndex({}, null), null, 'expected null when no order metadata exists');

const entries = [
  { rel: 'high-first', orderIndex: 20 },
  { rel: 'canonical-five', canonicalOrderIndex: 5 },
  { rel: 'explicit-five', orderIndex: 5 },
  { rel: 'fallback-index' }
];

const sorted = sortEntriesByOrderIndex(entries);
assert.deepEqual(
  sorted.map((entry) => entry.rel),
  ['fallback-index', 'canonical-five', 'explicit-five', 'high-first'],
  'expected stable ascending ordering by resolved order index'
);
assert.equal(entries[0].rel, 'high-first', 'expected source array to remain unchanged');

console.log('process-files ordering sort test passed');
