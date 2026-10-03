#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  buildCacheIdentity,
  buildCacheKey,
  flushCacheIndex,
  isCacheValid,
  pruneCacheIndex,
  readCacheEntry,
  readCacheIndex,
  resolveCacheIndexBinaryPath,
  resolveCacheIndexPath,
  shouldFastRejectCacheLookup,
  upsertCacheIndexEntry,
  writeCacheEntry,
  writeCacheIndex
} from '../../../tools/build/embeddings/cache.js';
import { flushCacheIndexIfNeeded } from '../../../tools/build/embeddings/cache-flush.js';
import {
  buildCacheIndexFileMap,
  mergeCacheIndex,
  normalizeCacheIndex,
  resolveNextShardIdFromShards
} from '../../../tools/build/embeddings/cache/index-state.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const toIso = (value) => new Date(value).toISOString();

{
  const base = buildCacheIdentity({
    modelId: 'model-a',
    provider: 'provider-a',
    mode: 'inline',
    stub: false,
    dims: 384,
    scale: 0.5
  });
  const dimsChanged = buildCacheIdentity({
    modelId: 'model-a',
    provider: 'provider-a',
    mode: 'inline',
    stub: false,
    dims: 768,
    scale: 0.5
  });
  const providerChanged = buildCacheIdentity({
    modelId: 'model-a',
    provider: 'provider-b',
    mode: 'inline',
    stub: false,
    dims: 384,
    scale: 0.5
  });
  assert.notEqual(base.key, dimsChanged.key, 'expected cache identity to change with dims');
  assert.notEqual(base.key, providerChanged.key, 'expected cache identity to change with provider');

  const signature = 'sig-1';
  const cached = {
    chunkSignature: signature,
    cacheMeta: { identityKey: base.key }
  };
  assert.equal(isCacheValid({ cached, signature, identityKey: base.key }), true);
  assert.equal(isCacheValid({ cached, signature, identityKey: dimsChanged.key }), false);

  const cacheKey = buildCacheKey({
    file: 'src/index.js',
    hash: 'hash-1',
    signature,
    identityKey: base.key,
    repoId: 'repo-1',
    mode: 'code',
    featureFlags: ['normalize'],
    pathPolicy: 'posix'
  });
  const cacheKeyOtherMode = buildCacheKey({
    file: 'src/index.js',
    hash: 'hash-1',
    signature,
    identityKey: base.key,
    repoId: 'repo-1',
    mode: 'prose',
    featureFlags: ['normalize'],
    pathPolicy: 'posix'
  });
  assert.ok(cacheKey, 'expected cache key for hashed file');
  assert.notEqual(cacheKey, cacheKeyOtherMode, 'expected cache key to change with mode');

  const cacheIndex = {
    version: 1,
    identityKey: 'identity-a',
    entries: {
      'key-a': {
        key: 'key-a',
        hash: 'hash-a',
        chunkSignature: 'sig-a',
        chunkHashesFingerprint: 'fp-a'
      }
    }
  };
  assert.equal(
    shouldFastRejectCacheLookup({
      cacheIndex,
      cacheKey: 'key-a',
      identityKey: 'identity-a',
      fileHash: 'hash-a',
      chunkSignature: 'sig-a'
    }),
    false
  );
  assert.equal(
    shouldFastRejectCacheLookup({
      cacheIndex,
      cacheKey: 'key-a',
      identityKey: 'identity-b',
      fileHash: 'hash-a',
      chunkSignature: 'sig-a'
    }),
    true
  );
  assert.equal(
    shouldFastRejectCacheLookup({
      cacheIndex,
      cacheKey: 'key-a',
      identityKey: 'identity-a',
      fileHash: 'hash-a',
      chunkSignature: 'sig-a',
      chunkHashesFingerprint: 'fp-b'
    }),
    true
  );
}

{
  const canonicalMap = buildCacheIndexFileMap({
    'key-old': {
      file: 'src/dup.js',
      lastAccessAt: toIso('2024-01-01T00:00:00Z'),
      hits: 10,
      createdAt: toIso('2024-01-01T00:00:00Z')
    },
    'key-new': {
      file: 'src/dup.js',
      lastAccessAt: toIso('2025-01-01T00:00:00Z'),
      hits: 1,
      createdAt: toIso('2025-01-01T00:00:00Z')
    },
    'key-side': {
      file: 'src/side.js',
      lastAccessAt: toIso('2025-02-01T00:00:00Z'),
      hits: 1,
      createdAt: toIso('2025-02-01T00:00:00Z')
    }
  });
  assert.equal(canonicalMap['src/dup.js'], 'key-new');
  assert.equal(canonicalMap['src/side.js'], 'key-side');

  const normalized = normalizeCacheIndex(
    {
      version: 1,
      identityKey: 'id',
      createdAt: toIso('2025-01-01T00:00:00Z'),
      updatedAt: toIso('2025-01-01T00:00:00Z'),
      nextShardId: 0,
      currentShard: null,
      entries: {
        a: {
          key: 'a',
          file: 'src/a.js',
          lastAccessAt: toIso('2025-01-01T00:00:00Z'),
          createdAt: toIso('2025-01-01T00:00:00Z')
        }
      },
      files: {
        'src/stale.js': 'stale-key',
        'src/a.js': 'wrong-key'
      },
      shards: {}
    },
    'id'
  );
  assert.deepEqual(normalized.files, { 'src/a.js': 'a' });
  assert.equal(
    normalizeCacheIndex(
      {
        version: 1,
        identityKey: 'id',
        createdAt: toIso('2025-01-01T00:00:00Z'),
        updatedAt: toIso('2025-01-01T00:00:00Z'),
        nextShardId: 0,
        currentShard: null,
        entries: {},
        files: {},
        shards: {
          'shard-00007.bin': { createdAt: toIso('2025-01-01T00:00:00Z'), sizeBytes: 1 }
        }
      },
      'id'
    ).nextShardId,
    8
  );
  assert.equal(
    resolveNextShardIdFromShards({
      'shard-00001.bin': { sizeBytes: 1 },
      'shard-00009.bin': { sizeBytes: 1 },
      'custom.bin': { sizeBytes: 1 }
    }),
    10
  );

  const base = {
    version: 1,
    identityKey: 'id',
    createdAt: toIso('2025-01-01T00:00:00Z'),
    updatedAt: toIso('2025-01-01T00:00:00Z'),
    nextShardId: 0,
    currentShard: null,
    entries: {
      alpha: {
        key: 'alpha',
        file: 'src/merge.js',
        lastAccessAt: toIso('2025-01-01T00:00:00Z'),
        createdAt: toIso('2025-01-01T00:00:00Z')
      }
    },
    files: {
      'src/merge.js': 'alpha',
      'src/ghost.js': 'ghost'
    },
    shards: {
      'shard-00002.bin': { createdAt: toIso('2025-01-01T00:00:00Z'), sizeBytes: 1024 }
    }
  };
  mergeCacheIndex(base, {
    nextShardId: 3,
    entries: {
      beta: {
        key: 'beta',
        file: 'src/merge.js',
        lastAccessAt: toIso('2026-01-01T00:00:00Z'),
        createdAt: toIso('2026-01-01T00:00:00Z')
      }
    },
    files: {
      'src/ghost.js': 'ghost'
    },
    shards: {
      'shard-00010.bin': { createdAt: toIso('2026-01-01T00:00:00Z'), sizeBytes: 1024 }
    }
  });
  assert.equal(base.files['src/merge.js'], 'beta');
  assert.equal(base.files['src/ghost.js'], undefined);
  assert.equal(base.nextShardId, 11);
}

{
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'embeddings-cache-index-contract-matrix');
  const cacheDir = path.join(tempRoot, 'files');
  const lockPath = path.join(cacheDir, 'cache.lock');
  const cacheKey = 'cache-entry-key';
  const identityKey = 'identity-test-key';
  const now = new Date().toISOString();

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
  await fsPromises.mkdir(cacheDir, { recursive: true });

  const payload = {
    key: cacheKey,
    file: 'src/sample.js',
    hash: 'hash-1',
    chunkSignature: 'sig-1',
    cacheMeta: {
      schemaVersion: 1,
      identityKey,
      createdAt: now
    },
    codeVectors: [[1, 2, 3]],
    docVectors: [[1, 2, 3]],
    mergedVectors: [[1, 2, 3]]
  };

  const writeResult = await writeCacheEntry(cacheDir, cacheKey, payload);
  assert.ok(writeResult?.path);
  assert.ok(Number(writeResult.sizeBytes) > 0);
  assert.ok(fs.existsSync(writeResult.path));

  const index = {
    version: 1,
    identityKey,
    createdAt: now,
    updatedAt: now,
    nextShardId: 0,
    currentShard: null,
    entries: {},
    files: {},
    shards: {}
  };
  const indexEntry = upsertCacheIndexEntry(index, cacheKey, payload, writeResult);
  assert.ok(indexEntry);
  assert.equal(indexEntry.shard, null);
  assert.equal(indexEntry.path, writeResult.path);
  assert.equal(index.files['src/sample.js'], cacheKey);

  upsertCacheIndexEntry(
    index,
    cacheKey,
    {
      ...payload,
      file: 'src/moved.js',
      hash: 'hash-2'
    },
    writeResult
  );
  assert.equal(index.files['src/sample.js'], undefined);
  assert.equal(index.files['src/moved.js'], cacheKey);

  const loaded = await readCacheEntry(cacheDir, cacheKey, index);
  assert.ok(loaded?.entry);
  assert.equal(loaded.path, writeResult.path);

  const pruneResult = await pruneCacheIndex(cacheDir, index, { maxBytes: 1 });
  assert.ok(pruneResult.removedKeys.includes(cacheKey));
  assert.ok(!fs.existsSync(writeResult.path));

  const onDisk = buildIndex({ hits: 5, lastAccessAt: '2026-02-10T00:00:05.000Z' });
  await writeCacheIndex(cacheDir, onDisk);

  const jsonPath = resolveCacheIndexPath(cacheDir);
  const binaryPath = resolveCacheIndexBinaryPath(cacheDir);
  await fsPromises.access(jsonPath);
  await fsPromises.access(binaryPath);

  const jsonPreferredPayload = {
    ...onDisk,
    updatedAt: '2026-02-10T00:00:15.000Z',
    entries: {
      [cacheKey]: {
        ...onDisk.entries[cacheKey],
        hits: 99
      }
    }
  };
  await fsPromises.writeFile(jsonPath, JSON.stringify(jsonPreferredPayload, null, 2), 'utf8');
  const readWithBinary = await readCacheIndex(cacheDir, identityKey);
  assert.equal(readWithBinary.entries?.[cacheKey]?.hits, 5, 'expected binary sidecar to be preferred when present');

  await fsPromises.writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));
  const readWithCorruptBinary = await readCacheIndex(cacheDir, identityKey);
  assert.equal(readWithCorruptBinary.entries?.[cacheKey]?.hits, 99, 'expected JSON fallback when binary sidecar is unreadable');
  await writeCacheIndex(cacheDir, onDisk);

  const incoming = buildIndex({ hits: 5, lastAccessAt: '2026-02-10T00:00:10.000Z' });
  const flushResult = await flushCacheIndex(cacheDir, incoming, { identityKey });
  assert.equal(flushResult.locked, true);

  const merged = await readCacheIndex(cacheDir, identityKey);
  const mergedEntry = merged.entries?.[cacheKey] || null;
  assert.ok(mergedEntry);
  assert.equal(mergedEntry.hits, 5);
  assert.equal(mergedEntry.lastAccessAt, '2026-02-10T00:00:10.000Z');

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
        staleMs: 60000
      }
    });
    assert.equal(lockedResult.locked, false);

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
    assert.equal(keepDirty.cacheIndexDirty, true);

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
    assert.equal(clearDirty.cacheIndexDirty, false);
  } finally {
    await heldLock.release({ force: true });
    await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
  }
}

console.log('embedding cache index contract matrix test passed');
