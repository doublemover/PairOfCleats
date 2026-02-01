#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readCacheMeta, writeCacheMeta } from '../../../tools/build-embeddings/cache.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'cache-preflight-meta');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const mode = 'code';
const missing = readCacheMeta(tempRoot, mode);
assert.equal(missing, null, 'expected missing cache meta to return null');

const meta = {
  version: 1,
  identityKey: 'abc123',
  dims: 256,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
await writeCacheMeta(tempRoot, mode, meta);

const loaded = readCacheMeta(tempRoot, mode);
assert.ok(loaded, 'expected cache meta to be readable');
assert.equal(loaded.identityKey, meta.identityKey);
assert.equal(loaded.dims, meta.dims);

console.log('cache preflight meta test passed');
