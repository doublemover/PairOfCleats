#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildChunksFromBundles } from '../../../tools/build/embeddings/chunks.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('chunks-from-bundle-shards');
const bundleDir = path.join(root, 'files');
const seed = async (file, rows) => {
  const entry = { hash: 'source', size: 1, mtimeMs: 1, dependencySignatures: { parse: 'fixture' } };
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
    bundles: rows.map(chunk => ({ ...entry, file, chunks: [chunk] })), format: 'json' });
  return { ...entry, ...snapshot };
};
try {
  const fileA = 'src/A.ts', fileZ = 'src/z.ts';
  for (const [label, ids, expected, total] of [
    ['missing ids', [null, null, null], [0, 1, 2], 3],
    ['mixed ids', [4, null, null], [4, 5, 6], 7],
    ['explicit ids', [4, 1, 8], [4, 1, 8], 9]
  ]) {
    const row = (i, file) => ({ ...(ids[i] == null ? {} : { id: ids[i] }), file,
      chunkUid: `row-${i}`, text: `row-${i}` });
    const manifest = { [fileA]: await seed(fileA, [row(0, fileA), row(1, fileA)]),
      [fileZ]: await seed(fileZ, [row(2, fileZ)]) };
    const forward = await buildChunksFromBundles(bundleDir, manifest, 'json');
    const reversed = await buildChunksFromBundles(bundleDir, Object.fromEntries(Object.entries(manifest).reverse()), 'json');
    assert.deepEqual([...forward.chunksByFile], [...reversed.chunksByFile], `${label}: manifest order cannot change fallback IDs/scatter`);
    assert.deepEqual([...forward.chunksByFile.keys()], [fileA, fileZ]);
    assert.deepEqual([...forward.chunksByFile.values()].flat().map(row => row.index), expected);
    assert.equal(forward.totalChunks, total);
  }
  const aliases = { 'src/./A.ts': await seed(fileA, [{ id: 4, file: fileA, chunkUid: 'alias-a' }]),
    'src\\A.ts': await seed(fileA, [{ id: 1, file: fileA, chunkUid: 'alias-b' }]) };
  const aliasResult = await buildChunksFromBundles(bundleDir, aliases, 'json');
  const reversed = await buildChunksFromBundles(bundleDir, Object.fromEntries(Object.entries(aliases).reverse()), 'json');
  assert.deepEqual([...aliasResult.chunksByFile], [...reversed.chunksByFile]);
  assert.equal(aliasResult.chunksByFile.size, 1);
  assert.deepEqual(aliasResult.chunksByFile.get(fileA).map(row => row.index), [4, 1]);
  const wrongSource = { 'src/wrong.ts': aliases['src/./A.ts'] };
  assert.equal((await buildChunksFromBundles(bundleDir, wrongSource, 'json')).chunksByFile.size, 0,
    'fallback cannot bypass manifest-bound source identity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Verified immutable shards, canonical aliases, deterministic fallback IDs and source-bound grouping pass.');
