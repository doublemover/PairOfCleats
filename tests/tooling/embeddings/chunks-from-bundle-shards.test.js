#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildChunksFromBundles } from '../../../tools/build/embeddings/chunks.js';
import { resolveBundleShardFilename } from '../../../src/shared/bundle-io-paths.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `chunks-from-bundle-shards-${process.pid}-${Date.now()}`);
const bundleDir = path.join(tempRoot, 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const relPath = 'src/example.ts';
const shard0 = resolveBundleShardFilename(relPath, 'json', 0);
const shard1 = resolveBundleShardFilename(relPath, 'json', 1);

try {
  await writeBundleFile({
    bundlePath: path.join(bundleDir, shard0),
    format: 'json',
    bundle: {
      file: relPath,
      hash: 'abc',
      mtimeMs: 1,
      size: 1,
      chunks: [{ id: 0, file: relPath, chunkUid: 'ck:0', text: 'zero' }]
    }
  });
  await writeBundleFile({
    bundlePath: path.join(bundleDir, shard1),
    format: 'json',
    bundle: {
      file: relPath,
      hash: 'abc',
      mtimeMs: 1,
      size: 1,
      chunks: [{ id: 1, file: relPath, chunkUid: 'ck:1', text: 'one' }]
    }
  });

  const { chunksByFile, totalChunks } = await buildChunksFromBundles(bundleDir, {
    [relPath]: {
      hash: 'abc',
      mtimeMs: 1,
      size: 1,
      bundles: [shard0, shard1],
      bundleFormat: 'json'
    }
  }, 'json');

  assert.equal(totalChunks, 2, 'expected both shard chunks to be indexed');
  const rows = chunksByFile.get(relPath) || [];
  assert.equal(rows.length, 2, 'expected combined shard rows for file');
  assert.deepEqual(
    rows.map((entry) => entry.index).sort((a, b) => a - b),
    [0, 1],
    'expected chunk ids from both bundle shards'
  );

  const fileA = 'src/A.ts';
  const fileZ = 'src/z.ts';
  const a0 = resolveBundleShardFilename(fileA, 'json', 0);
  const a1 = resolveBundleShardFilename(fileA, 'json', 1);
  const z0 = resolveBundleShardFilename(fileZ, 'json', 0);
  const manifest = {
    [fileA]: { bundles: [a0, a1], bundleFormat: 'json' },
    [fileZ]: { bundles: [z0], bundleFormat: 'json' }
  };
  const reversedManifest = Object.fromEntries(Object.entries(manifest).reverse());
  for (const [label, ids, expectedIndexes, expectedTotal] of [
    ['missing ids', [null, null, null], [0, 1, 2], 3],
    ['mixed ids', [4, null, null], [4, 5, 6], 7],
    ['explicit ids', [4, 1, 8], [4, 1, 8], 9]
  ]) {
    for (const [index, file, bundle] of [[0, fileA, a0], [1, fileA, a1], [2, fileZ, z0]]) {
      await writeBundleFile({
        bundlePath: path.join(bundleDir, bundle),
        format: 'json',
        bundle: {
          file, hash: `hash-${index}`, mtimeMs: 1, size: 1,
          chunks: [{ ...(ids[index] === null ? {} : { id: ids[index] }), file, chunkUid: `row-${index}`, text: `row-${index}` }]
        }
      });
    }
    const forward = await buildChunksFromBundles(bundleDir, manifest, 'json');
    const reversed = await buildChunksFromBundles(bundleDir, reversedManifest, 'json');
    assert.deepEqual([...reversed.chunksByFile], [...forward.chunksByFile], `${label}: manifest order must not change file/chunk order or fallback ids`);
    assert.equal(forward.totalChunks, expectedTotal);
    assert.equal(reversed.totalChunks, expectedTotal);
    assert.deepEqual([...forward.chunksByFile.keys()], [fileA, fileZ]);
    const orderedRows = [...forward.chunksByFile.values()].flat();
    assert.deepEqual(orderedRows.map((row) => row.index), expectedIndexes, `${label}: preserve explicit ids and per-file shard order`);
    assert.deepEqual(orderedRows.map((row) => row.chunk.chunkUid), ['row-0', 'row-1', 'row-2']);
  }
  const aliases = { 'z-alias': { bundles: [a1] }, 'a-alias': { bundles: [a0] } };
  const aliasResult = await buildChunksFromBundles(bundleDir, aliases, 'json');
  const reversedAliases = await buildChunksFromBundles(bundleDir, Object.fromEntries(Object.entries(aliases).reverse()), 'json');
  assert.deepEqual([...aliasResult.chunksByFile], [...reversedAliases.chunksByFile], 'aliases targeting one logical file must merge deterministically');
  assert.equal(aliasResult.chunksByFile.size, 1);
  assert.deepEqual(aliasResult.chunksByFile.get(fileA).map((row) => row.index), [4, 1], 'ordering must not deduplicate or reassign explicit ids');
  console.log('embeddings chunks-from-bundle-shards test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
