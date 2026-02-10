#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  bitmapToSet,
  createBitmapFromIds,
  getBitmapSize,
  intersectBitmaps,
  intersectSetWithBitmap,
  isBitmapEmpty,
  isRoaringAvailable,
  unionBitmaps
} from '../../../../src/retrieval/bitmap.js';
import {
  buildFilterIndex,
  hydrateFilterIndex,
  serializeFilterIndex
} from '../../../../src/retrieval/filter-index.js';
import { createCandidateHelpers } from '../../../../src/retrieval/output/filters/candidates.js';
import { collectFilePrefilterMatches } from '../../../../src/retrieval/output/filters/file-prefilter.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

if (!isRoaringAvailable()) {
  console.log('roaring-wasm not available; skipping filter-index bitmap roundtrip test');
  process.exit(0);
}

const buildChunk = ({ id, file }) => ({
  id,
  file,
  ext: '.js',
  kind: 'FunctionDeclaration',
  last_author: 'Alice',
  chunk_authors: ['Alice'],
  docmeta: { visibility: 'public' },
  metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
});

const BIG_FILE = 'src/big.js';
const SMALL_FILE = 'src/small.js';
const bigCount = 300;

const meta = [];
for (let i = 0; i < bigCount; i += 1) {
  meta.push(buildChunk({ id: i, file: BIG_FILE }));
}
for (let i = bigCount; i < bigCount + 5; i += 1) {
  meta.push(buildChunk({ id: i, file: SMALL_FILE }));
}

const index = buildFilterIndex(meta);
assert.ok(index.bitmap, 'expected bitmap index');
assert.ok(Array.isArray(index.bitmap.fileChunksById), 'expected per-file chunk bitmaps');

const bigFileId = index.fileIdByPath.get(BIG_FILE);
const smallFileId = index.fileIdByPath.get(SMALL_FILE);
assert.equal(typeof bigFileId, 'number', 'missing big fileId');
assert.equal(typeof smallFileId, 'number', 'missing small fileId');

assert.equal(
  getBitmapSize(index.bitmap.fileChunksById[bigFileId]),
  bigCount,
  'big file bitmap size mismatch'
);
assert.equal(
  index.bitmap.fileChunksById[smallFileId],
  null,
  'expected small file bitmap to be omitted (below threshold)'
);

const raw = serializeFilterIndex(index);
const hydrated = hydrateFilterIndex(raw);
assert.ok(hydrated.bitmap, 'expected hydrated bitmap index');
assert.ok(
  Array.isArray(hydrated.bitmap.fileChunksById),
  'expected hydrated per-file chunk bitmaps'
);
assert.equal(
  getBitmapSize(hydrated.bitmap.fileChunksById[bigFileId]),
  bigCount,
  'hydrated big file bitmap size mismatch'
);

const helpers = createCandidateHelpers({
  roaringAvailable: true,
  bitmapToSet,
  createBitmapFromIds,
  unionBitmaps,
  intersectBitmaps,
  intersectSetWithBitmap,
  isBitmapEmpty,
  getBitmapSize,
  preferBitmap: true,
  bitmapMinSize: 1
});

const candidate = collectFilePrefilterMatches({
  fileMatchers: [{ type: 'substring', value: BIG_FILE }],
  fileChargramN: hydrated.fileChargramN,
  filterIndex: hydrated,
  normalizeFilePrefilter: (value) => String(value || '').toLowerCase(),
  intersectTwoSets: helpers.intersectTwoSets,
  buildCandidate: helpers.buildCandidate
});

assert.ok(candidate && candidate.bitmap, 'expected bitmap candidate from file prefilter');
assert.equal(getBitmapSize(candidate.bitmap), bigCount, 'prefilter bitmap size mismatch');

console.log('filter-index bitmap roundtrip test passed');
