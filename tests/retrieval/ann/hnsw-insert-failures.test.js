#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'hnsw-insert-failures');
const indexPath = path.join(tempRoot, 'dense_vectors_hnsw.bin');
const metaPath = path.join(tempRoot, 'dense_vectors_hnsw.meta.json');

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw insert failure test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const require = createRequire(import.meta.url);
const modulePath = require.resolve('hnswlib-node');
const originalExports = require(modulePath);

class FakeHNSW {
  constructor(space, dims) {
    this.space = space;
    this.dims = dims;
  }
  initIndex() {}
  addPoint(_vec, label) {
    if (label === 1) {
      throw new Error('simulated insert failure');
    }
  }
  writeIndexSync() {}
}

try {
  const cached = require.cache[modulePath];
  if (cached) {
    cached.exports = { HierarchicalNSW: FakeHNSW, default: FakeHNSW };
  }
  const { createHnswBuilder } = await import('../../../tools/build/embeddings/hnsw.js');
  const builder = createHnswBuilder({
    enabled: true,
    config: normalizeHnswConfig({}),
    totalChunks: 2,
    mode: 'code',
    logger: null
  });
  builder.addVector(0, [0, 0]);
  builder.addVector(1, [1, 1]);

  let threw = false;
  try {
    await builder.writeIndex({
      indexPath,
      metaPath,
      modelId: 'test-model',
      dims: 2,
      quantization: { minVal: -1, maxVal: 1, levels: 256 },
      scale: 1
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'expected writeIndex to throw on insert failures');

  const reportPath = metaPath.replace(/\.meta\.json$/i, '.failures.json');
  assert.ok(fs.existsSync(reportPath), 'expected failure report to be written');
  const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
  assert.equal(report.failed, 1);
  assert.ok(Array.isArray(report.failedChunks));
} finally {
  const cached = require.cache[modulePath];
  if (cached) {
    cached.exports = originalExports;
  }
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('hnsw insert failure test passed');
