#!/usr/bin/env node
import { createRequire } from 'node:module';
import { rankHnswIndex } from '../../../src/shared/hnsw.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw distance metrics test.' });

const require = createRequire(import.meta.url);
const hnswlib = require('hnswlib-node');

const HNSW = hnswlib?.HierarchicalNSW || hnswlib?.default?.HierarchicalNSW || hnswlib?.default;
if (!HNSW) {
  console.log('hnsw distance metrics test skipped: HNSW constructor missing');
  process.exit(0);
}

const runCase = ({ space, vectors, query, expectedTop }) => {
  const index = new HNSW(space, 2);
  index.initIndex({
    maxElements: vectors.length,
    m: 16,
    efConstruction: 200,
    randomSeed: 42,
    allowReplaceDeleted: false
  });
  vectors.forEach((vec, idx) => index.addPoint(vec, idx));
  const hits = rankHnswIndex({ index, space }, new Float32Array(query), 2, null);
  if (!hits.length) {
    throw new Error(`expected hits for space=${space}`);
  }
  if (hits[0].idx !== expectedTop) {
    throw new Error(`space=${space}: expected top=${expectedTop}, got ${hits[0].idx}`);
  }
  if (hits.length > 1 && hits[0].sim < hits[1].sim) {
    throw new Error(`space=${space}: results not sorted by similarity`);
  }
};

try {
  runCase({
    space: 'l2',
    vectors: [[0, 0], [1, 0]],
    query: [0, 0],
    expectedTop: 0
  });
  runCase({
    space: 'cosine',
    vectors: [[1, 0], [0, 1]],
    query: [1, 0],
    expectedTop: 0
  });
  runCase({
    space: 'ip',
    vectors: [[1, 0], [0.5, 0.5]],
    query: [1, 0],
    expectedTop: 0
  });
} catch (err) {
  console.error(`hnsw distance metrics test failed: ${err?.message || err}`);
  process.exit(1);
}

console.log('hnsw distance metrics test passed');
