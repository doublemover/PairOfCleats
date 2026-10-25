import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { loadIndexCached } from '../../../src/retrieval/cli/index-loader.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunkIds } from '../../../src/retrieval/output/filters.js';
import { getScmProvider } from '../../../src/index/scm/registry.js';
import { hydrateChunkAuthorsForIndex, __testScmChunkAuthorHydration } from '../../../src/retrieval/cli/chunk-authors.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('chunk-author-filter-cache-coherence');
await fs.mkdir(path.join(root, '.git'));
await fs.writeFile(path.join(root, 'alpha.txt'), 'first line\n');
const indexDir = path.join(root, 'index-prose'); await fs.mkdir(indexDir);
const provider = getScmProvider('git'), originalAnnotate = provider.annotate;
let annotated = 0;
try {
  provider.annotate = async () => { annotated++; return { lines: [{ line: 1, author: 'Bob' }] }; };
  __testScmChunkAuthorHydration.reset();
  const cache = createIndexCache({ maxEntries: 2, ttlMs: 0 });
  const backend = createIndexBackendLoader({ rootDir: root, userConfig: {}, indexCache: cache,
    filtersActive: true, annActive: false, fileChargramN: 3, requiredArtifacts: new Set(['filterIndex']), strict: true });
  const row = { id: 0, file: 'alpha.txt', startLine: 1, endLine: 1, last_author: 'Alice' };
  const base = { indexDir, state: { buildId: '20261025T120000Z_abcd_abcdef1_12345678',
    repo: { head: { commitId: 'a'.repeat(40) } } }, chunkMeta: [row] };
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ mode: 'prose', ...base.state }));
  base.filterIndex = buildFilterIndex(base.chunkMeta, { fileChargramN: 3 });
  let loads = 0;
  const prime = async payload => loadIndexCached({ ...backend.cachedLoadOptions, indexCache: cache, dir: indexDir,
    fileChargramN: 3, strict: true, loadIndex: async () => { loads++; return payload; } });
  assert.strictEqual(await prime(base), base);
  const load = () => backend.loadModeIndex({ mode: 'prose', run: true, dir: indexDir });
  const hydrate = idx => hydrateChunkAuthorsForIndex({ idx, mode: 'prose', rootDir: root,
    userConfig: { indexing: { scm: { provider: 'git' } } }, fileChargramN: 3,
    filtersActive: true, chunkAuthorFilterActive: true, emitOutput: false });
  const ids = (idx, indexed = true) => [...filterChunkIds(idx.chunkMeta, { chunkAuthor: 'Bob' },
    indexed ? idx.filterIndex : null, null, { preferBitmap: false })];
  const first = await load(), coordinated = await load();
  assert.strictEqual(first.chunkMeta, base.chunkMeta); assert.strictEqual(coordinated.chunkMeta, base.chunkMeta);
  await hydrate(first); assert.deepEqual(ids(first), [0]); assert.deepEqual(ids(first, false), [0]);
  assert.equal(row.chunk_authors, undefined, 'shared cache facts remain unchanged');
  assert.deepEqual(ids(coordinated), [], 'a not-yet-hydrated wrapper retains its coherent old pair');
  await hydrate(coordinated); assert.deepEqual(ids(coordinated), [0]);
  assert.strictEqual(coordinated.chunkMeta, first.chunkMeta);
  assert.strictEqual(coordinated.filterIndex, first.filterIndex);
  for (let request = 0; request < 3; request++) {
    const warm = await load(); await hydrate(warm);
    assert.deepEqual(ids(warm), [0]); assert.deepEqual(ids(warm, false), [0]);
    assert.strictEqual(warm.chunkMeta, first.chunkMeta); assert.strictEqual(warm.filterIndex, first.filterIndex);
  }
  const stats = __testScmChunkAuthorHydration.getStats();
  assert.equal(loads, 1); assert.equal(annotated, 1);
  assert.equal(stats.metadataCopies, 1); assert.equal(stats.filterIndexBuilds, 1);
  assert.equal(stats.materializationHits, 4);
  const failure = new Error('controlled metadata construction failure');
  const badRow = { ...row };
  Object.defineProperty(badRow, 'coldAnnotationTrap', { enumerable: true, get() { throw failure; } });
  const refused = { ...base, chunkMeta: [badRow] }, originalRows = refused.chunkMeta, originalFilter = refused.filterIndex;
  await assert.rejects(hydrate(refused), error => error === failure);
  assert.strictEqual(refused.chunkMeta, originalRows); assert.strictEqual(refused.filterIndex, originalFilter);
  assert.equal(badRow.chunk_authors, undefined, 'failed construction cannot publish half-enriched facts');
  cache.clear();
  const replacementRow = { ...row, id: 0, file: 'alpha.txt', last_author: 'Carol' };
  const replacement = { ...base, state: { buildId: '20261025T120001Z_abcd_cdef123_12345678',
    repo: { head: { commitId: 'c'.repeat(40) } } }, chunkMeta: [replacementRow] };
  replacement.filterIndex = buildFilterIndex(replacement.chunkMeta, { fileChargramN: 3 });
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ mode: 'prose', ...replacement.state }));
  await prime(replacement);
  const fresh = await load(); await hydrate(fresh); assert.deepEqual(ids(fresh), [0]);
  assert.notStrictEqual(fresh.chunkMeta, first.chunkMeta); assert.notStrictEqual(fresh.filterIndex, first.filterIndex);
  assert.equal(annotated, 2, 'changed generation cannot reuse the old author map');
  assert.equal(replacementRow.chunk_authors, undefined);
} finally { provider.annotate = originalAnnotate; __testScmChunkAuthorHydration.reset(); }
console.log('shared artifact-cache author hydration publishes coherent reusable request overlays');
