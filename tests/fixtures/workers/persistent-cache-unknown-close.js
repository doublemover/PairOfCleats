import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureChunkCache, resolveChunkCacheKey, resolvePersistentChunkCachePaths, resolvePersistentChunkCacheRoot,
  loadCachedChunks, storeCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
const root = process.argv[2];
assert.ok(path.isAbsolute(root));
const options = { treeSitter: { enabled: true, chunkCache: true, cachePersistent: true, cachePersistentDir: root } };
resolvePersistentChunkCacheRoot(options);
const { cache, maxEntries } = ensureChunkCache(options), sourceLength = 64;
const key = resolveChunkCacheKey({ ...options, treeSitterCacheKey: 'unknown-close' }, 'javascript');
const paths = resolvePersistentChunkCachePaths(root, key), chunks = [{ start: 0, end: 16, name: 'f', kind: 'FunctionDeclaration' }];
storeCachedChunks({ cache, key, chunks, maxEntries, cacheRoot: root, sourceLength }); cache.clear();
treeSitterState.persistentChunkCacheMemo.clear(); treeSitterState.persistentChunkCacheMisses.clear();
const originalOpen = fs.openSync, originalClose = fs.closeSync;
const closeFailure = new Error('original contained cache close failure');
let activeFd, opens = 0, closes = 0, failure;
fs.openSync = function(file, ...args) { const fd = originalOpen.call(this, file, ...args);
  if (path.resolve(String(file)) === paths.canonical) { activeFd = fd; opens++; } return fd; };
fs.closeSync = function(fd) { if (fd === activeFd) { closes++; throw closeFailure; } return originalClose.call(this, fd); };
try { loadCachedChunks({ cache, key, cacheRoot: root, sourceLength }); assert.fail('unknown closure must escape'); }
catch (error) { failure = error; }
const find = (error, seen = new Set()) => {
  if (!error || typeof error !== 'object' || seen.has(error)) return null; seen.add(error);
  return getContainedFileSession(error) || find(error.cause, seen) || (error.errors || []).map(value => find(value, seen)).find(Boolean);
};
const session = find(failure); assert.ok(session); assert.equal(observeStorageResource(failure).isSettled(), false);
const containsOriginal = (error, seen = new Set()) => {
  if (error === closeFailure) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
  return containsOriginal(error.cause, seen) || (error.errors || []).some(child => containsOriginal(child, seen));
};
assert.ok(containsOriginal(failure), 'preserve the exact originally thrown synchronous close failure');
assert.throws(() => session.releaseAfterCloseSync());
assert.equal(session.isSettled(), false); assert.equal(closes, 1, 'unknown synchronous close is never retried by descriptor number');
assert.throws(() => storeCachedChunks({ cache, key, chunks, maxEntries, cacheRoot: root, sourceLength }),
  error => !observeStorageResource(error).isSettled());
assert.throws(() => loadCachedChunks({ cache, key, cacheRoot: root, sourceLength }),
  error => !observeStorageResource(error).isSettled());
assert.equal(opens, 1, 'no replacement work while the original descriptor remains unconfirmed');
assert.equal(closes, 1);
console.log(JSON.stringify({ pending: true, descriptorCloseAttempts: closes, opens, boundary: 'real-child-exit-required' }));
// Deliberately retain the original session. Only this process's actual exit
// disposes the unknown descriptor; no native-close recovery is claimed.
