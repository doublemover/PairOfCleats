#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunkIds } from '../../../src/retrieval/output.js';
import { getBitmapSize, isRoaringAvailable } from '../../../src/retrieval/bitmap.js';

process.env.PAIROFCLEATS_TESTING = '1';

if (!isRoaringAvailable()) {
  console.log('roaring-wasm not available; skipping bitmap threshold test');
  process.exit(0);
}

const meta = Array.from({ length: 12 }, (_, idx) => ({
  id: idx,
  file: `src/${idx}.js`,
  ext: '.js',
  kind: 'FunctionDeclaration',
  last_author: 'Alice',
  chunk_authors: ['Alice'],
  docmeta: { visibility: 'public' },
  metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
}));

const index = buildFilterIndex(meta);
const filters = { ext: '.js' };

const bitmapResult = filterChunkIds(meta, filters, index, null, { preferBitmap: true, bitmapMinSize: 4 });
assert.ok(bitmapResult && !(bitmapResult instanceof Set), 'expected bitmap output above threshold');
assert.equal(getBitmapSize(bitmapResult), meta.length, 'bitmap result size mismatch');

const setResult = filterChunkIds(meta, filters, index, null, { preferBitmap: true, bitmapMinSize: 20 });
assert.ok(setResult instanceof Set, 'expected Set output below threshold');
assert.equal(setResult.size, meta.length, 'Set result size mismatch');

console.log('filter bitmap threshold test passed');
