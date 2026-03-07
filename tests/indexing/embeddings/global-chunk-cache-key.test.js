#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildCacheKey,
  buildGlobalChunkCacheKey,
  isGlobalChunkCacheValid,
  readCacheEntry,
  resolveCacheBase,
  resolveGlobalChunkCacheDir,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-global-chunk-cache-key');
const cacheRoot = path.join(tempRoot, 'cache');
const identity = { provider: 'provider-a', modelId: 'model-a', dims: 384 };
const identityKey = 'identity-a';
const payloadHash = 'chunk-payload-hash-a';

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });

const baseDir = resolveCacheBase(cacheRoot, identity);
const globalChunkCacheDir = resolveGlobalChunkCacheDir(cacheRoot, identity);
assert.equal(
  globalChunkCacheDir,
  path.join(baseDir, 'global-chunks'),
  'expected mode-agnostic chunk cache to be rooted under provider/model/dims base'
);

const globalKeyCode = buildGlobalChunkCacheKey({
  chunkHash: payloadHash,
  identityKey,
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
const globalKeyProse = buildGlobalChunkCacheKey({
  chunkHash: payloadHash,
  identityKey,
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.equal(globalKeyCode, globalKeyProse, 'expected global chunk cache key to be mode-agnostic');

const globalKeyDifferentHash = buildGlobalChunkCacheKey({
  chunkHash: 'chunk-payload-hash-b',
  identityKey,
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.notEqual(globalKeyCode, globalKeyDifferentHash, 'expected global chunk cache key to vary by payload hash');

const globalKeyDifferentIdentity = buildGlobalChunkCacheKey({
  chunkHash: payloadHash,
  identityKey: 'identity-b',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.notEqual(globalKeyCode, globalKeyDifferentIdentity, 'expected global chunk cache key to vary by identity');

const perFileCodeKey = buildCacheKey({
  file: 'src/example.js',
  hash: 'file-hash-a',
  signature: 'sig-a',
  identityKey,
  repoId: 'repo-a',
  mode: 'code',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
const perFileProseKey = buildCacheKey({
  file: 'src/example.js',
  hash: 'file-hash-a',
  signature: 'sig-a',
  identityKey,
  repoId: 'repo-a',
  mode: 'prose',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
});
assert.notEqual(perFileCodeKey, perFileProseKey, 'expected existing per-file cache key mode semantics');

await fs.mkdir(globalChunkCacheDir, { recursive: true });
const payload = {
  key: globalKeyCode,
  hash: payloadHash,
  cacheMeta: {
    identityKey
  },
  codeVectors: [new Uint8Array([1, 2, 3])],
  docVectors: [new Uint8Array([4, 5, 6])],
  mergedVectors: [new Uint8Array([7, 8, 9])]
};
await writeCacheEntry(globalChunkCacheDir, globalKeyCode, payload);

const cached = (await readCacheEntry(globalChunkCacheDir, globalKeyCode)).entry;
assert.ok(cached, 'expected cached global chunk entry to round-trip from disk');
assert.equal(
  isGlobalChunkCacheValid({ cached, identityKey, chunkHash: payloadHash }),
  true,
  'expected matching global chunk cache identity/hash to validate'
);
assert.equal(
  isGlobalChunkCacheValid({ cached, identityKey: 'identity-b', chunkHash: payloadHash }),
  false,
  'expected global chunk cache identity mismatch to invalidate'
);
assert.equal(
  isGlobalChunkCacheValid({ cached, identityKey, chunkHash: 'chunk-payload-hash-b' }),
  false,
  'expected global chunk cache payload hash mismatch to invalidate'
);

console.log('global chunk cache key test passed');
