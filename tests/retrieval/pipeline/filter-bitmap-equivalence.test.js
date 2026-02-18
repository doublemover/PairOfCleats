#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunks, filterChunkIds } from '../../../src/retrieval/output.js';
import { bitmapToArray } from '../../../src/retrieval/bitmap.js';

applyTestEnv();

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
    file: 'src/c.py',
    ext: '.py',
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    chunk_authors: ['Alice'],
    docmeta: { visibility: 'public' },
    metaV2: { lang: 'python', effective: { languageId: 'python' } }
  }
];

const index = buildFilterIndex(meta);
const filters = { ext: '.js', author: 'alice' };

const expected = filterChunks(meta, filters, index)
  .map((entry) => entry.id)
  .sort((a, b) => a - b);

const allowed = filterChunkIds(meta, filters, index, null, { preferBitmap: true });
const allowedIds = allowed == null
  ? meta.map((entry) => entry.id)
  : (allowed instanceof Set ? Array.from(allowed) : bitmapToArray(allowed));

allowedIds.sort((a, b) => a - b);
assert.deepEqual(allowedIds, expected, 'bitmap allowlist should match filterChunks results');

console.log('filter bitmap equivalence test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
