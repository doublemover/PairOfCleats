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

const noFileFixture = {
  code: [
    { id: 'nf1', file: '', score: 0.7, scoreType: 'bm25', start: 0, end: 1 },
    { id: 'nf2', file: null, score: 0.6, scoreType: 'bm25', start: 1, end: 2 }
  ],
  extractedProse: [],
  prose: [
    { id: 'nf3', file: undefined, score: 0.5, scoreType: 'fts', start: 2, end: 3 }
  ],
  records: []
};
const noFileFirst = buildResultBundles(noFileFixture);
const noFileSecond = buildResultBundles(noFileFixture);
assert.deepEqual(noFileFirst, noFileSecond, 'expected deterministic synthetic bundle keys for no-file hits');
assert.equal(noFileFirst.groups.length, 3, 'expected no-file hits to remain stable as independent synthetic bundles');
assert.ok(
  noFileFirst.groups.every((group) => group.file === null),
  'expected synthetic bundles to keep null file field for no-file hits'
);

const originalLocaleCompare = String.prototype.localeCompare;
String.prototype.localeCompare = function localeCompareDisabled() {
  throw new Error('localeCompare must not be used for deterministic ordering');
};
try {
  const localeNeutral = buildResultBundles({
    code: [
      { id: 'alpha-hit', file: 'src/alpha.js', score: 2, scoreType: 'bm25', start: 0, end: 1 },
      { id: 'z-hit', file: 'src/z.js', score: 2, scoreType: 'bm25', start: 0, end: 1 }
    ],
    extractedProse: [],
    prose: [],
    records: []
  });
  assert.deepEqual(
    localeNeutral.groups.map((group) => group.file),
    ['src/alpha.js', 'src/z.js'],
    'expected locale-neutral lexical tie ordering'
  );
} finally {
  String.prototype.localeCompare = originalLocaleCompare;
}

console.log('bundle assembly deterministic test passed');
