#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildChunksFromBundles } from '../../../tools/build/embeddings/chunks.js';
import { resolveBundleShardFilename, writeBundleFile } from '../../../src/shared/bundle-io.js';
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
  console.log('embeddings chunks-from-bundle-shards test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

