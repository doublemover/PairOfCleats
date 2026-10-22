import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { buildCacheIdentity, resolveGlobalChunkCacheDir, resolveCacheDir, writeCacheIndex,
  withEmbeddingCacheReadLock } from '../../../tools/build/embeddings/cache.js';
import { readEmbeddingIndex, appendEmbeddingIndexDelta } from '../../../tools/build/embeddings/cache/index-log.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { inspectEmbeddingStorageProfile } from '../../../tools/storage/embedding-adapter.js';

const temporary = await makeTempDir('poc-storage-embedding-delta-');
try {
  const { identity, key } = buildCacheIdentity({ provider: 'stub', modelId: 'storage-fixture', dims: 2 });
  const global = resolveGlobalChunkCacheDir(temporary, identity);
  const files = resolveCacheDir(temporary, identity, 'code');
  const chunkKey = 'a'.repeat(40);
  const fileKey = 'b'.repeat(40);
  for (const [directory, entryKey, extra] of [[global, chunkKey, {}],
    [files, fileKey, { chunkReferences: { schemaVersion: 1, identityKey: key, keys: [chunkKey] } }]]) {
    await fs.mkdir(path.join(directory, 'shards'), { recursive: true });
    await fs.writeFile(path.join(directory, 'shards', 'shard-00000.bin'), Buffer.alloc(8));
    await writeCacheIndex(directory, createCacheIndex(key));
    await withEmbeddingCacheReadLock(directory, async () => {
      const index = await readEmbeddingIndex(directory, key, { forUpdate: true });
      index.entries[entryKey] = { key: entryKey, shard: 'shard-00000.bin', offset: 0, length: 4, storageEpoch: 0, ...extra };
      index.shards['shard-00000.bin'] = { sizeBytes: 8 };
      await appendEmbeddingIndexDelta(directory, index, { keys: [entryKey] });
    });
  }
  const checkpoint = JSON.parse(await fs.readFile(path.join(files, 'cache.index.json'), 'utf8'));
  assert.equal(Object.keys(checkpoint.entries).length, 0, 'fixture entry exists only in the committed delta');
  const before = await fs.readdir(temporary, { recursive: true });
  const inventory = await inspectEmbeddingStorageProfile({ cacheRoot: temporary, identity });
  const fileIndex = inventory.indexes.find(index => index.directory === files);
  assert.equal(fileIndex.entries, 1, 'canonical owner includes delta-only pointers');
  assert.equal(inventory.references.protectedChunkKeys, 1, 'delta-only file references protect immutable chunks');
  assert.equal(inventory.protectedMetadata.includes('cache.index.delta'), true);
  assert.equal(inventory.cleanupAuthority, false);
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before, 'inventory does not create locks or compatibility roots');
  await fs.appendFile(path.join(files, 'cache.index.delta'), Buffer.from([1]));
  const incomplete = await inspectEmbeddingStorageProfile({ cacheRoot: temporary, identity });
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.references.complete, false, 'unreadable reference authority never becomes disposable');
} finally { await rmDirRecursive(temporary); }
console.log('embedding delta reference inventory passed');
