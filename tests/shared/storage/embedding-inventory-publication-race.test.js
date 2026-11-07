import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCacheIdentity, resolveGlobalChunkCacheDir, resolveCacheDir,
  writeCacheIndex, withEmbeddingCacheReadLock } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { inspectEmbeddingStorageProfile } from '../../../tools/storage/embedding-adapter.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/embedding-inventory-publication-race/')[1];
const scope = path.resolve('.tmp/tasks/embedding-inventory-race'); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fs.writeFile(path.join(temporary, '.owned-fixture'), marker);
const original = { stat: fs.stat, lstat: fs.lstat, opendir: fs.opendir };
const same = (actual, expected) => typeof actual === 'string' && path.resolve(actual) === path.resolve(expected);
let armed = false, published = false, fileIndexRead = false;
try {
  const { identity, key } = buildCacheIdentity({ provider: 'stub', modelId: 'inventory-race', dims: 2, stub: true });
  const global = resolveGlobalChunkCacheDir(temporary, identity), files = resolveCacheDir(temporary, identity, 'code');
  const chunkKey = 'a'.repeat(40), fileKey = 'b'.repeat(40);
  for (const [directory, entryKey, extra] of [[global, chunkKey, {}],
    [files, fileKey, { chunkReferences: { schemaVersion: 1, identityKey: key, keys: [chunkKey] } }]]) {
    const index = createCacheIndex(key);
    index.entries[entryKey] = { key: entryKey, shard: 'shard-00000.bin', offset: 0, length: 4, storageEpoch: 0, ...extra };
    index.shards['shard-00000.bin'] = { sizeBytes: 8 };
    await writeCacheIndex(directory, index);
    await fs.mkdir(path.join(directory, 'shards'), { recursive: true });
    await fs.writeFile(path.join(directory, 'shards', 'shard-00000.bin'), Buffer.alloc(8));
  }
  const publish = async () => {
    if (!armed || published) return;
    published = true;
    await withEmbeddingCacheReadLock(files, () => writeCacheIndex(files, createCacheIndex(key)));
  };
  if (mode === 'reference-before-mode-baseline') {
    fs.stat = async (...args) => {
      const value = await original.stat(...args);
      if (armed && same(args[0], path.join(files, 'cache.index.json'))) fileIndexRead = true;
      return value;
    };
    fs.lstat = async (...args) => {
      if (fileIndexRead && same(args[0], path.join(resolveCacheDir(temporary, identity, 'prose'), 'cache.index.json'))) await publish();
      return original.lstat(...args);
    };
  } else if (mode === 'publication-during-physical-inventory') {
    fs.opendir = async (...args) => {
      const directory = await original.opendir(...args);
      if (same(args[0], global)) {
        try { await publish(); } catch (error) { await directory.close(); throw error; }
      }
      return directory;
    };
  } else throw new Error(`Unknown publication-race case: ${mode}`);
  armed = true;
  const result = await inspectEmbeddingStorageProfile({ cacheRoot: temporary, identity });
  assert.equal(published, true, 'the real cache owner must publish the competing checkpoint');
  assert.equal(result.physical.complete, true, 'ordinary physical inventory is independently complete');
  assert.equal(result.complete, false, 'mixed logical/reference metadata cannot qualify as a coherent observation');
  assert.equal(result.references.complete, false);
  assert.ok(result.failures.some(failure => failure.directory === files && failure.reason === 'concurrent-embedding-publication'));
  assert.equal(result.cleanupAuthority, false);
} finally {
  Object.assign(fs, original);
  assert.equal(isPathWithinRoot(temporary, scope), true);
  assertNoSymlinkPath(scope, temporary);
  assert.equal(await fs.readFile(path.join(temporary, '.owned-fixture'), 'utf8'), marker);
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`embedding inventory publication race passed: ${mode}`);
