#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { compileFilterPredicates } from '../../../src/retrieval/output/filters.js';
import { filterChunks, filterChunkIds } from '../../../src/retrieval/output.js';
import { bitmapToArray } from '../../../src/retrieval/bitmap.js';

process.env.PAIROFCLEATS_TESTING = '1';

const meta = [
  {
    id: 0,
    file: 'src/a.js',
    ext: '.js',
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    chunk_authors: ['Alice'],
    docmeta: { visibility: 'public' },
    metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
  },
  {
    id: 1,
    file: 'src/b.js',
    ext: '.js',
    kind: 'ClassDeclaration',
    last_author: 'Bob',
    chunk_authors: ['Bob'],
    docmeta: { visibility: 'private' },
    metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
  },
  {
    id: 2,
    file: 'tests/c.ts',
    ext: '.ts',
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    chunk_authors: ['Alice'],
    docmeta: { visibility: 'public' },
    metaV2: { lang: 'typescript', effective: { languageId: 'typescript' } }
  }
];

const index = buildFilterIndex(meta);
const filters = {
  file: '/src/.*\\.js$/',
  ext: '.js',
  caseFile: false
};

const compiled = compileFilterPredicates(filters, { fileChargramN: 3 });
const matcherRef = compiled.fileMatchers;

const expected = filterChunks(meta, filters, index)
  .map((entry) => entry.id)
  .sort((a, b) => a - b);

const allowed = filterChunkIds(meta, filters, index, null, { compiled, preferBitmap: true });
const allowedIds = allowed == null
  ? meta.map((entry) => entry.id)
  : (allowed instanceof Set ? Array.from(allowed) : bitmapToArray(allowed));

allowedIds.sort((a, b) => a - b);
assert.deepEqual(allowedIds, expected, 'compiled predicates should match filterChunks results');
assert.equal(compiled.fileMatchers, matcherRef, 'compiled matchers should be reused');

console.log('filter compiled reuse test passed');
