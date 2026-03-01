#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flushCacheIndex, readCacheIndex, writeCacheIndex } from '../../../tools/build/embeddings/cache.js';
import { flushCacheIndexIfNeeded } from '../../../tools/build/embeddings/cache-flush.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-index-flush-contract');
const cacheDir = path.join(tempRoot, 'files');
const lockPath = path.join(cacheDir, 'cache.lock');
const identityKey = 'identity-test-key';
const cacheKey = 'cache-entry-key';

const buildIndex = ({ hits, lastAccessAt }) => ({
  version: 1,
  identityKey,
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: lastAccessAt,
  nextShardId: 1,
  currentShard: 'shard-00000.bin',
  entries: {
    [cacheKey]: {
      key: cacheKey,
      file: 'src/sample.js',
      hash: 'hash-1',
      chunkSignature: 'sig-1',
      shard: 'shard-00000.bin',
      offset: 4,
      length: 16,
      sizeBytes: 20,
      chunkCount: 1,
      createdAt: '2026-02-10T00:00:00.000Z',
      lastAccessAt,
      hits
    }
  },
  files: {
    'src/sample.js': cacheKey
  },
  shards: {
    'shard-00000.bin': {
      createdAt: '2026-02-10T00:00:00.000Z',
      sizeBytes: 20
    }
  }
});

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fs.mkdir(cacheDir, { recursive: true });

const onDisk = buildIndex({ hits: 5, lastAccessAt: '2026-02-10T00:00:05.000Z' });
await writeCacheIndex(cacheDir, onDisk);

const incoming = buildIndex({ hits: 5, lastAccessAt: '2026-02-10T00:00:10.000Z' });
const flushResult = await flushCacheIndex(cacheDir, incoming, { identityKey });
assert.equal(flushResult.locked, true, 'expected flush to acquire lock');

const merged = await readCacheIndex(cacheDir, identityKey);
const mergedEntry = merged.entries?.[cacheKey] || null;
assert.ok(mergedEntry, 'expected merged entry in cache index');
assert.equal(mergedEntry.hits, 5, 'expected absolute hit counter merge (no additive inflation)');
assert.equal(
  mergedEntry.lastAccessAt,
  '2026-02-10T00:00:10.000Z',
  'expected most recent lastAccessAt to be preserved'
);

const heldLock = await acquireFileLock({
  lockPath,
  waitMs: 0,
  timeoutBehavior: 'throw',
  timeoutMessage: 'failed to acquire test cache lock'
});

try {
  const pending = buildIndex({ hits: 7, lastAccessAt: '2026-02-10T00:00:20.000Z' });
  const lockedResult = await flushCacheIndex(cacheDir, pending, {
    identityKey,
    lock: {
      waitMs: 25,
      pollMs: 5,
      staleMs: 60_000
    }
  });
  assert.equal(lockedResult.locked, false, 'expected lock contention to report locked=false');

  const keepDirty = await flushCacheIndexIfNeeded({
    cacheDir,
    cacheIndex: pending,
    cacheEligible: true,
    cacheIndexDirty: true,
    cacheIdentityKey: identityKey,
    cacheMaxBytes: 0,
    cacheMaxAgeMs: 0,
    scheduleIo: (work) => work(),
    flushCacheIndex: async () => ({ locked: false })
  });
  assert.equal(
    keepDirty.cacheIndexDirty,
    true,
    'expected dirty flag to remain set when flush cannot acquire lock'
  );

  const clearDirty = await flushCacheIndexIfNeeded({
    cacheDir,
    cacheIndex: pending,
    cacheEligible: true,
    cacheIndexDirty: true,
    cacheIdentityKey: identityKey,
    cacheMaxBytes: 0,
    cacheMaxAgeMs: 0,
    scheduleIo: (work) => work(),
    flushCacheIndex: async () => ({ locked: true })
  });
  assert.equal(
    clearDirty.cacheIndexDirty,
    false,
    'expected dirty flag to clear only when flush lock is acquired'
  );
} finally {
  await heldLock.release({ force: true });
}

console.log('embeddings cache index flush contract test passed');
