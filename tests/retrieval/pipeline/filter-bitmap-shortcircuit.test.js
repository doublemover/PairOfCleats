#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunkIds } from '../../../src/retrieval/output.js';
import { getBitmapSize } from '../../../src/retrieval/bitmap.js';

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
    file: 'src/b.py',
    ext: '.py',
    kind: 'ClassDeclaration',
    last_author: 'Bob',
    chunk_authors: ['Bob'],
    docmeta: { visibility: 'private' },
    metaV2: { lang: 'python', effective: { languageId: 'python' } }
  }
];

const index = buildFilterIndex(meta);

const allResult = filterChunkIds(meta, {}, index);
assert.equal(allResult, null, 'expected null allowlist when filters do not narrow');

const noneResult = filterChunkIds(meta, { ext: '.rs' }, index, null, { preferBitmap: true });
const noneCount = noneResult ? getBitmapSize(noneResult) : 0;
assert.equal(noneCount, 0, 'expected empty allowlist for non-matching filters');

console.log('filter bitmap shortcircuit test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
