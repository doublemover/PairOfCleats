#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  readCacheIndex,
  resolveCacheIndexBinaryPath,
  resolveCacheIndexPath,
  writeCacheIndex
} from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-index-binary-sidecar');
const cacheDir = path.join(tempRoot, 'files');
const identityKey = 'identity:test:binary-sidecar';
const cacheKey = 'cache-key';

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });

const baseIndex = {
  version: 1,
  identityKey,
  createdAt: '2026-02-20T00:00:00.000Z',
  updatedAt: '2026-02-20T00:00:10.000Z',
  nextShardId: 1,
  currentShard: 'shard-00000.bin',
  entries: {
    [cacheKey]: {
      key: cacheKey,
      file: 'src/example.js',
      hash: 'hash-1',
      chunkSignature: 'sig-1',
      shard: 'shard-00000.bin',
      offset: 4,
      length: 16,
      sizeBytes: 20,
      chunkCount: 1,
      createdAt: '2026-02-20T00:00:00.000Z',
      lastAccessAt: '2026-02-20T00:00:10.000Z',
      hits: 1
    }
  },
  files: {
    'src/example.js': cacheKey
  },
  shards: {
    'shard-00000.bin': {
      createdAt: '2026-02-20T00:00:00.000Z',
      sizeBytes: 20
    }
  }
};

await writeCacheIndex(cacheDir, baseIndex);
const jsonPath = resolveCacheIndexPath(cacheDir);
const binaryPath = resolveCacheIndexBinaryPath(cacheDir);
assert.ok(jsonPath, 'expected json cache index path');
assert.ok(binaryPath, 'expected binary cache index path');

await fs.access(jsonPath);
await fs.access(binaryPath);

const jsonPreferredPayload = {
  ...baseIndex,
  updatedAt: '2026-02-20T00:00:20.000Z',
  entries: {
    [cacheKey]: {
      ...baseIndex.entries[cacheKey],
      hits: 99
    }
  }
};
await fs.writeFile(jsonPath, JSON.stringify(jsonPreferredPayload, null, 2), 'utf8');

const readWithBinary = await readCacheIndex(cacheDir, identityKey);
assert.equal(
  readWithBinary.entries?.[cacheKey]?.hits,
  1,
  'expected binary sidecar to be preferred when present'
);

await fs.writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));
const readWithCorruptBinary = await readCacheIndex(cacheDir, identityKey);
assert.equal(
  readWithCorruptBinary.entries?.[cacheKey]?.hits,
  99,
  'expected JSON fallback when binary sidecar is unreadable'
);

console.log('embeddings cache index binary sidecar test passed');
