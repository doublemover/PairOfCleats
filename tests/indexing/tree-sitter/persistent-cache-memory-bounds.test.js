#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureChunkCache, loadCachedChunks, resolveChunkCacheKey, resolvePersistentChunkCacheRoot, resolvePersistentChunkCachePaths, storeCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parser-memo-bounds-'));
const options = { treeSitter: { chunkCacheMaxEntries: 2, cachePersistent: true, cachePersistentDir: path.join(root, 'cache') } };
const cacheRoot = resolvePersistentChunkCacheRoot(options);
const { cache, maxEntries } = ensureChunkCache(options);
const keyFor = (key) => resolveChunkCacheKey({ ...options, treeSitterCacheKey: key }, 'javascript');
const keys = Array.from({ length: 8 }, (_, id) => keyFor(`source-${id}`));
const chunksFor = (id) => [{ start: id, end: id + 1, kind: 'function', name: `fn${id}`, meta: { label: `original-${id}` } }];
const fileFor = key => resolvePersistentChunkCachePaths(cacheRoot, key).canonical;
const originalRead = fsSync.readSync, originalOpen=fsSync.openSync, originalClose=fsSync.closeSync, cacheFds=new Set();
let reads=0;
fsSync.openSync=function(file,...args){const fd=originalOpen.call(this,file,...args);if(String(file).startsWith(cacheRoot+path.sep))cacheFds.add(fd);return fd;};
fsSync.readSync=function(fd,...args){if(cacheFds.has(fd))reads++;return originalRead.call(this,fd,...args);};
fsSync.closeSync=function(fd){try{return originalClose.call(this,fd);}finally{cacheFds.delete(fd);}};

try {
  for (let id = 0; id < keys.length; id += 1) {
    storeCachedChunks({ sourceLength:64, cache, key: keys[id], chunks: chunksFor(id), maxEntries, cacheRoot });
  }
  assert.equal(cache.size, 2);
  assert.equal(treeSitterState.persistentChunkCacheMemo.size, 2, 'auxiliary positive rows must respect the configured chunk entry cap');
  for (const key of keys) assert.ok(fsSync.existsSync(fileFor(key)), 'in-memory eviction leaves persistent files intact');
  cache.clear();
  reads = 0;
  const cold = loadCachedChunks({ sourceLength:64, cache, key: keys[0], cacheRoot });
  assert.deepEqual(cold, chunksFor(0));
  assert.equal(reads, 1, 'evicted rows reload from persistent storage');
  cold[0].meta.label = 'changed by caller';
  assert.equal(loadCachedChunks({ sourceLength:64, cache, key: keys[0], cacheRoot })[0].meta.label, 'original-0');
  cache.clear();
  reads = 0;
  assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key: keys[7], cacheRoot }), chunksFor(7));
  assert.equal(reads, 0, 'the surviving memo entry still avoids a disk reread');
  assert.deepEqual([...treeSitterState.persistentChunkCacheMemo.keys()], [keys[0], keys[7]], 'memo hits refresh LRU order');

  const missing = Array.from({ length: 9 }, (_, id) => keyFor(`absent-${id}`));
  for (const key of missing) assert.equal(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot }), null);
  assert.equal(treeSitterState.persistentChunkCacheMisses.size, 2, 'negative memo keys must also remain bounded');
  assert.deepEqual([...treeSitterState.persistentChunkCacheMisses], missing.slice(-2));
  assert.equal(loadCachedChunks({ sourceLength:64, cache, key: missing[7], cacheRoot }), null);
  assert.deepEqual([...treeSitterState.persistentChunkCacheMisses], [missing[8], missing[7]]);
  storeCachedChunks({ sourceLength:64, cache, key: missing[7], chunks: chunksFor(17), maxEntries, cacheRoot });
  assert.ok(!treeSitterState.persistentChunkCacheMisses.has(missing[7]), 'own successful publication invalidates the negative memo');
  assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key: missing[7], cacheRoot }), chunksFor(17));

  // Reconfiguration trims auxiliary maps even before the next read/write.
  ensureChunkCache({ treeSitter: { chunkCacheMaxEntries: 1 } });
  assert.equal(treeSitterState.persistentChunkCacheMemo.size, 1);
  assert.ok(treeSitterState.persistentChunkCacheMisses.size <= 1);
  const secondRoot = resolvePersistentChunkCacheRoot({ treeSitter: { cachePersistent: true, cachePersistentDir: path.join(root, 'second') } });
  assert.equal(treeSitterState.persistentChunkCacheMemo.size, 0);
  assert.equal(treeSitterState.persistentChunkCacheMisses.size, 0);
  assert.equal(loadCachedChunks({ sourceLength:64, cache, key: keys[0], cacheRoot: secondRoot }), null, 'root changes retain existing memo invalidation');
  console.log('Persistent parser memo bounds passed:8 positive/9 negative keys bounded to2, disk reload/LRU, clone isolation, publication, shrink and root reset');
} finally {
  fsSync.readSync = originalRead;fsSync.openSync=originalOpen;fsSync.closeSync=originalClose;
  cache.clear();
  treeSitterState.persistentChunkCacheMemo.clear();
  treeSitterState.persistentChunkCacheMisses.clear();
  treeSitterState.persistentChunkCacheRoot = null;
  await fs.rm(root, { recursive: true, force: true });
}
