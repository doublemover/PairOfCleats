#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunks } from '../../../src/retrieval/output.js';

const chunkMeta = [
  { id: 0, file: 'src/Foo.js', ext: '.js' },
  { id: 1, file: 'src/foo.js', ext: '.js' }
];

const filterIndex = buildFilterIndex(chunkMeta, { fileChargramN: 3 });

const strictFilters = {
  file: 'Foo.js',
  caseFile: true,
  filePrefilter: { enabled: true, chargramN: 3 }
};
const strictHits = filterChunks(chunkMeta, strictFilters, filterIndex);
assert.equal(strictHits.length, 1);
assert.equal(strictHits[0].file, 'src/Foo.js');

const looseFilters = {
  file: 'Foo.js',
  caseFile: false,
  filePrefilter: { enabled: true, chargramN: 3 }
};
const looseHits = filterChunks(chunkMeta, looseFilters, filterIndex);
assert.equal(looseHits.length, 2);

console.log('file filter case sensitivity test passed');
