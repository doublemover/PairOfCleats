#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadHnswIndex, normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'hnsw-load-signature');
const indexPath = path.join(tempRoot, 'dense_vectors_hnsw.bin');

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw load signature test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.writeFile(indexPath, 'stub-index');

const require = createRequire(import.meta.url);
const modulePath = require.resolve('hnswlib-node');
const originalExports = require(modulePath);

class FakeHNSW {
  constructor(space, dims) {
    this.space = space;
    this.dims = dims;
  }
  readIndexSync(filePath) {
    FakeHNSW.lastArgs = [filePath];
  }
  setEf() {}
}
FakeHNSW.lastArgs = null;

try {
  const cached = require.cache[modulePath];
  if (cached) {
    cached.exports = { HierarchicalNSW: FakeHNSW, default: FakeHNSW };
  }
  const meta = { dims: 2, space: 'cosine' };
  const hnswConfig = normalizeHnswConfig({});
  const index = loadHnswIndex({
    indexPath,
    dims: 2,
    config: hnswConfig,
    meta
  });
  assert.ok(index, 'expected HNSW index to load with patched signature');
  assert.ok(FakeHNSW.lastArgs, 'expected readIndexSync to be called');
  assert.equal(FakeHNSW.lastArgs.length, 1, 'expected readIndexSync to receive a single argument');
} finally {
  const cached = require.cache[modulePath];
  if (cached) {
    cached.exports = originalExports;
  }
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('hnsw load signature test passed');
