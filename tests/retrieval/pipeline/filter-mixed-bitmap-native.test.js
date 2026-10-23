import assert from 'node:assert/strict';
import { bitmapToArray, isRoaringAvailable } from '../../../src/retrieval/bitmap.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { compileFilterPredicates, filterChunks, filterChunkIds } from '../../../src/retrieval/output/filters.js';
import { createModeExpander } from '../../../src/retrieval/cli/run-search-session/mode-expansion.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
assert.equal(isRoaringAvailable(), true, 'Real roaring is required for native mixed-bucket qualification; unavailable is not a pass.');
const makeChunk = (id, ext, name) => ({ id, file: `${name}${ext}`, ext, name,
  kind: 'FunctionDeclaration', last_author: ext === '.js' ? 'large' : ext === '.ts' ? 'small' : 'excluded',
  metaV2: { lang: ext === '.js' ? 'javascript' : ext === '.ts' ? 'typescript' : 'python' } });
for (const size of [255, 256, 257]) {
  const meta = Array.from({ length: size }, (_, id) => makeChunk(id, '.js', `large-${id}`));
  meta.push(makeChunk(size, '.ts', 'small'), makeChunk(size + 1, '.py', 'disallowed'));
  meta[0].name = 'seed';
  meta[0].codeRelations = { calls: [['seed', 'small'], ['seed', 'disallowed']] };
  const index = buildFilterIndex(meta), filters = { ext: ['.js', '.ts'] };
  const expected = Array.from({ length: size + 1 }, (_, id) => id);
  for (const selection of [filters, { author: ['large', 'small'] }, { file: ['large-', '.ts'] }]) {
    assert.deepEqual(filterChunks(meta, selection).map(row => row.id), expected);
    assert.deepEqual(filterChunks(meta, selection, index).map(row => row.id), expected);
    for (const preferBitmap of [undefined, false, true]) {
      const actual = filterChunkIds(meta, selection, index, null, { preferBitmap });
      assert.deepEqual((actual instanceof Set ? [...actual] : bitmapToArray(actual)).sort((a, b) => a - b), expected);
    }
  }
  const expanded = await createModeExpander({ contextExpansionEnabled: true,
    contextExpansionOptions: { includeCalls: true }, contextExpansionRespectFilters: true,
    filtersActive: true, filters, filterPredicates: compileFilterPredicates(filters)
  }).expandModeHits('code', { chunkMeta: meta, filterIndex: index }, [{ id: 0 }]);
  assert.deepEqual(expanded.contextHits.map(hit => hit.id), [size], 'actual context caller retains the small eligible target and rejects the excluded target');
}
console.log('Native mixed filter buckets retain membership across thresholds/preferences and actual context expansion.');
