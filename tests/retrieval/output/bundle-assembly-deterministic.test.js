#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildResultBundles, RESULT_BUNDLE_SCHEMA_VERSION } from '../../../src/retrieval/output/format.js';

const fixture = {
  code: [
    { id: 'c1', file: 'src/z.js', score: 1, scoreType: 'bm25', start: 0, end: 10 },
    { id: 'c2', file: 'src/a.js', score: 1, scoreType: 'bm25', start: 5, end: 15 }
  ],
  extractedProse: [],
  prose: [
    { id: 'p1', file: 'src/a.js', score: 1, scoreType: 'fts', start: 0, end: 20 },
    { id: 'p2', file: 'src/b.js', score: 1, scoreType: 'fts', start: 0, end: 20 }
  ],
  records: []
};

const first = buildResultBundles(fixture);
const second = buildResultBundles(fixture);

assert.deepEqual(first, second, 'expected deterministic bundle membership/order');
assert.equal(first.schemaVersion, RESULT_BUNDLE_SCHEMA_VERSION, 'expected bundle schema version');
assert.equal(first.groups.length, 3, 'expected grouped bundles by file');
assert.deepEqual(
  first.groups.map((group) => group.file),
  ['src/a.js', 'src/b.js', 'src/z.js'],
  'expected deterministic cross-bundle ordering with tie-breakers'
);

const topBundle = first.groups[0];
assert.equal(topBundle.file, 'src/a.js', 'expected highest aggregate-score file first');
assert.deepEqual(
  topBundle.hits.map((hit) => hit.mode),
  ['code', 'prose'],
  'expected deterministic in-bundle tie-breaker order'
);

console.log('bundle assembly deterministic test passed');
