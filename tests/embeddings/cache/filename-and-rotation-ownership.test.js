#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIndexFileMap, mergeCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { readCacheIndex, writeCacheIndex, writeCacheEntry, pruneCacheIndex,
  createShardAppendHandlePool } from '../../../tools/build/embeddings/cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('embedding-filename-rotation-ownership');
const identity = 'fixture-identity';
try {
  const now = new Date().toISOString();
  const entries = Object.fromEntries([['plain', 'foo.js', '2000-01-01T00:00:00.000Z'],
    ['leading', ' foo.js', now], ['trailing', 'foo.js ', now]].map(([key, file, timestamp]) => [key,
    { key, file, createdAt: timestamp, lastAccessAt: timestamp, sizeBytes: 1 }]));
  const state = await readCacheIndex(dir, identity);
  state.entries = entries; state.files = buildCacheIndexFileMap(entries);
  assert.deepEqual(state.files, { 'foo.js': 'plain', ' foo.js': 'leading', 'foo.js ': 'trailing' });
  await writeCacheIndex(dir, state);
  const loaded = await readCacheIndex(dir, identity);
  assert.deepEqual(loaded.files, state.files, 'write/read normalization preserves exact filename identity');
  mergeCacheIndex(loaded, { entries: { ...entries }, shards: {} });
  assert.deepEqual(loaded.files, state.files, 'merge keeps whitespace-distinct owners');
  await pruneCacheIndex(dir, loaded, { maxAgeMs: 1000, deleteShards: false });
  assert.deepEqual(loaded.files, { ' foo.js': 'leading', 'foo.js ': 'trailing' });
  await writeCacheIndex(dir, loaded);
  assert.deepEqual((await readCacheIndex(dir, identity)).files, loaded.files);

  for (const pooled of [false, true]) {
    const cacheDir = path.join(dir, `rotation-${pooled}`);
    const firstIndex = await readCacheIndex(cacheDir, identity);
    const secondIndex = await readCacheIndex(cacheDir, identity);
    const pool = pooled ? createShardAppendHandlePool() : null;
    try {
      const first = await writeCacheEntry(cacheDir, 'first', { file: 'a.js' },
        { index: firstIndex, encodedBuffer: Buffer.alloc(64, 1), maxShardBytes: 100, shardHandlePool: pool });
      // Deliberately do not upsert/flush the first index before the second
      // independent writer acquires the same real cross-process cache lock.
      const second = await writeCacheEntry(cacheDir, 'second', { file: 'b.js' },
        { index: secondIndex, encodedBuffer: Buffer.alloc(64, 2), maxShardBytes: 100, shardHandlePool: pool });
      assert.notEqual(first.shard, second.shard, 'actual locked append size determines rotation despite stale indexes');
      for (const pointer of [first, second]) {
        const stat = await fs.stat(path.join(cacheDir, 'shards', pointer.shard));
        assert.equal(stat.size, 68);
        assert.ok(stat.size <= 100);
      }
    } finally { await pool?.close(); }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Embedding cache preserves exact filenames and rotates from locked physical shard sizes.');
