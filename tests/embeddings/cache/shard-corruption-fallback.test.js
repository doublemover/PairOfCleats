#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readCacheEntry,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-shard-corruption-fallback');
const cacheDir = path.join(tempRoot, 'files');
const cacheKey = 'cache-corrupt-shard-fallback';
const now = new Date().toISOString();

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(cacheDir, 'shards'), { recursive: true });

const payload = {
  key: cacheKey,
  file: 'src/sample.js',
  hash: 'hash-1',
  chunkSignature: 'sig-1',
  cacheMeta: {
    schemaVersion: 1,
    identityKey: 'identity-test-key',
    createdAt: now
  },
  codeVectors: [[1, 2, 3]],
  docVectors: [[1, 2, 3]],
  mergedVectors: [[1, 2, 3]]
};

const fallbackWrite = await writeCacheEntry(cacheDir, cacheKey, payload);
assert.ok(fallbackWrite?.path, 'expected standalone fallback cache entry');

const shardName = 'shard-00000.bin';
const shardPath = path.join(cacheDir, 'shards', shardName);
const corruptPrefix = Buffer.alloc(4);
corruptPrefix.writeUInt32LE(256, 0);
await fs.writeFile(shardPath, corruptPrefix);

const index = {
  version: 1,
  identityKey: 'identity-test-key',
  createdAt: now,
  updatedAt: now,
  nextShardId: 1,
  currentShard: shardName,
  entries: {
    [cacheKey]: {
      key: cacheKey,
      file: payload.file,
      hash: payload.hash,
      chunkSignature: payload.chunkSignature,
      shard: shardName,
      path: null,
      offset: 4,
      length: 256
    }
  },
  files: {},
  shards: {
    [shardName]: {
      createdAt: now,
      sizeBytes: corruptPrefix.length
    }
  }
};

const loaded = await readCacheEntry(cacheDir, cacheKey, index);
assert.ok(loaded?.entry, 'expected cache lookup to fall back when shard entry is corrupt/truncated');
assert.equal(loaded.path, fallbackWrite.path, 'expected fallback standalone entry path to be used');
assert.equal(loaded.entry?.file, payload.file);
assert.equal(index.entries[cacheKey].shard, null, 'expected shard pointer to be cleared after corrupt read fallback');
assert.equal(index.entries[cacheKey].path, fallbackWrite.path, 'expected index entry to repair to standalone path');
const loadedAgain = await readCacheEntry(cacheDir, cacheKey, index);
assert.equal(loadedAgain.path, fallbackWrite.path, 'expected repaired index entry to avoid re-reading corrupt shard');
assert.equal(loadedAgain.entry?.file, payload.file);

console.log('embeddings cache shard corruption fallback test passed');
