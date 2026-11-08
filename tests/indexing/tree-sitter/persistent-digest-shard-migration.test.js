import { createChunkCachePayload } from '../../../src/lang/tree-sitter/chunking/cache-schema.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureChunkCache, resolveChunkCacheKey, resolvePersistentChunkCacheRoot,
  resolvePersistentChunkCachePaths, loadCachedChunks, storeCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('persistent-digest-shard-migration');
const options = { treeSitter: { cachePersistent: true, cachePersistentDir: dir } };
resolvePersistentChunkCacheRoot(options);
const keys = Array.from({ length: 256 }, (_, id) => resolveChunkCacheKey({ ...options, treeSitterCacheKey: `source-${id}` }, 'javascript'));
assert.ok(new Set(keys.map(key => path.basename(path.dirname(resolvePersistentChunkCachePaths(dir, key).canonical)))).size > 64);
const key = keys[0], paths = resolvePersistentChunkCachePaths(dir, key), chunks = [{ name: 'fixture', start: 0, end: 1, kind:'FunctionDeclaration', meta: { role: 'function' } }];
assert.deepEqual(resolvePersistentChunkCachePaths(dir, key), paths);
fs.mkdirSync(path.dirname(paths.legacy), { recursive: true });
fs.writeFileSync(paths.legacy, JSON.stringify(createChunkCachePayload(key,chunks,64)));
const clear = () => { treeSitterState.chunkCache?.clear(); treeSitterState.persistentChunkCacheMemo?.clear(); treeSitterState.persistentChunkCacheMisses?.clear(); };
const { cache, maxEntries } = ensureChunkCache(options);
assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot: dir }), chunks);
assert.equal(fs.existsSync(paths.canonical), true); assert.equal(fs.existsSync(paths.legacy), false);
// Simulate interrupted cleanup after the canonical copy was published.
fs.copyFileSync(paths.canonical, paths.legacy); clear();
assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot: dir }), chunks);
assert.equal(fs.existsSync(paths.legacy), false);
// A corrupt new-layout payload cannot strand a compatible legacy record.
fs.copyFileSync(paths.canonical, paths.legacy); fs.writeFileSync(paths.canonical, '{broken'); clear();
assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot: dir }), chunks);
assert.equal(JSON.parse(fs.readFileSync(paths.canonical, 'utf8')).cacheKey, key);
const other = path.join(dir, 'other root with spaces');
clear(); assert.equal(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot: other }), null);
storeCachedChunks({ sourceLength:64, cache, key, chunks, maxEntries, cacheRoot: other }); clear();
assert.deepEqual(loadCachedChunks({ sourceLength:64, cache, key, cacheRoot: other }), chunks);
console.log('digest sharding preserves old-only cache entries and resumes interrupted retirement');
