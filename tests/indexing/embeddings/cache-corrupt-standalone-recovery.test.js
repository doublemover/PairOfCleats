#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  readCacheEntry,
  resolveCacheEntryPath
} from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-corrupt-standalone-recovery');
const cacheDir = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheDir, { recursive: true });

const keyWithLegacyFallback = 'corrupt-primary';
const corruptPrimaryPath = resolveCacheEntryPath(cacheDir, keyWithLegacyFallback);
const validLegacyPath = resolveCacheEntryPath(cacheDir, keyWithLegacyFallback, { legacy: true });
await fsPromises.writeFile(corruptPrimaryPath, Buffer.from('not-a-valid-encoded-cache-entry', 'utf8'));
await fsPromises.writeFile(
  validLegacyPath,
  JSON.stringify({ cacheMeta: { identityKey: 'id-1' }, codeVectors: [], proseVectors: [] }),
  'utf8'
);

const indexWithLegacy = {
  entries: {
    [keyWithLegacyFallback]: {
      key: keyWithLegacyFallback,
      path: corruptPrimaryPath
    }
  },
  files: {},
  shards: {}
};

const recovered = await readCacheEntry(cacheDir, keyWithLegacyFallback, indexWithLegacy);
assert.ok(recovered?.entry, 'expected corrupt primary cache file to fall back to legacy cache entry');
assert.equal(recovered.path, validLegacyPath, 'expected fallback read path to use legacy cache entry');
assert.equal(fs.existsSync(corruptPrimaryPath), false, 'expected corrupt primary cache entry to be removed');
assert.equal(
  indexWithLegacy.entries[keyWithLegacyFallback]?.path,
  validLegacyPath,
  'expected cache index entry path to repoint to surviving legacy cache entry'
);

const keyCorruptOnly = 'corrupt-only';
const corruptOnlyPath = resolveCacheEntryPath(cacheDir, keyCorruptOnly);
await fsPromises.writeFile(corruptOnlyPath, Buffer.from('still-not-a-valid-cache-entry', 'utf8'));
const indexCorruptOnly = {
  entries: {
    [keyCorruptOnly]: {
      key: keyCorruptOnly,
      path: corruptOnlyPath
    }
  },
  files: {},
  shards: {}
};

const missingAfterCorrupt = await readCacheEntry(cacheDir, keyCorruptOnly, indexCorruptOnly);
assert.equal(missingAfterCorrupt?.entry, null, 'expected corrupt standalone cache entry without fallback to miss');
assert.equal(fs.existsSync(corruptOnlyPath), false, 'expected corrupt standalone cache entry to be removed');

console.log('embeddings cache corrupt standalone recovery test passed');
