#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildBoilerplateCatalog } from '../../../src/index/build/artifacts/boilerplate-catalog.js';

const catalog = buildBoilerplateCatalog([
  {
    file: 'a.js',
    docmeta: {
      boilerplateRef: 'license-a',
      boilerplatePosition: 'top',
      boilerplateTags: ['license', 'header']
    }
  },
  {
    file: 'a.js',
    docmeta: {
      boilerplateRef: 'license-a',
      boilerplatePosition: 'top',
      boilerplateTags: ['license']
    }
  },
  {
    file: 'b.js',
    docmeta: {
      boilerplateRef: 'license-a',
      boilerplatePosition: 'bottom',
      boilerplateTags: ['generated']
    }
  },
  {
    file: 'c.js',
    docmeta: {
      boilerplateRef: 'notice-b',
      boilerplateTags: []
    }
  }
]);

assert.equal(catalog.length, 2, 'expected two boilerplate refs in catalog');
assert.equal(catalog[0].ref, 'license-a', 'expected highest-count ref first');
assert.equal(catalog[0].count, 3, 'expected aggregate count per ref');
assert.deepEqual(
  catalog[0].positions,
  { top: 2, bottom: 1 },
  'expected per-position counts to aggregate'
);
assert.deepEqual(
  catalog[0].tags,
  ['generated', 'header', 'license'],
  'expected unique, sorted tag list'
);
assert.deepEqual(
  catalog[0].sampleFiles,
  ['a.js', 'b.js'],
  'expected sample files to dedupe by file path'
);

assert.equal(catalog[1].ref, 'notice-b', 'expected secondary ref to remain present');
assert.equal(catalog[1].positions.unknown, 1, 'expected missing position to normalize to unknown bucket');

console.log('boilerplate catalog aggregation test passed');
