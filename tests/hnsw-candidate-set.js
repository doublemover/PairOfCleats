#!/usr/bin/env node
import { createRequire } from 'node:module';
import { rankHnswIndex } from '../src/shared/hnsw.js';
import { requireHnswLib } from './helpers/optional-deps.js';

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw candidate set test.' });

const require = createRequire(import.meta.url);
const hnswlib = require('hnswlib-node');

const HNSW = hnswlib?.HierarchicalNSW || hnswlib?.default?.HierarchicalNSW || hnswlib?.default;
if (!HNSW) {
  console.log('hnsw candidate set test skipped: HNSW constructor missing');
  process.exit(0);
}

const index = new HNSW('l2', 2);
index.initIndex({
  maxElements: 3,
  m: 16,
  efConstruction: 200,
  randomSeed: 42,
  allowReplaceDeleted: false
});
index.addPoint([0, 0], 0);
index.addPoint([1, 0], 1);
index.addPoint([0, 1], 2);

const query = new Float32Array([0, 0]);

const emptyHits = rankHnswIndex({ index, space: 'l2' }, query, 2, new Set());
if (emptyHits.length !== 0) {
  console.error('hnsw candidate set test failed: expected empty hits for empty candidate set');
  process.exit(1);
}

const candidates = new Set([1, 2]);
const hits = rankHnswIndex({ index, space: 'l2' }, query, 2, candidates);
if (!hits.length) {
  console.error('hnsw candidate set test failed: expected hits with candidate set');
  process.exit(1);
}
if (hits.some((hit) => !candidates.has(hit.idx))) {
  console.error('hnsw candidate set test failed: hits include non-candidate ids');
  process.exit(1);
}
if (hits.length > 1 && hits[0].sim < hits[1].sim) {
  console.error('hnsw candidate set test failed: results not sorted by similarity');
  process.exit(1);
}
if (hits.length > 1 && hits[0].sim === hits[1].sim && hits[0].idx > hits[1].idx) {
  console.error('hnsw candidate set test failed: tie-break not stable');
  process.exit(1);
}
if (hits[0].sim > 0) {
  console.error('hnsw candidate set test failed: expected negative sim for L2 distance');
  process.exit(1);
}

const largeCandidates = new Set(Array.from({ length: 1000 }, (_, i) => i));
const largeHits = rankHnswIndex({ index, space: 'l2' }, query, 2, largeCandidates);
if (!largeHits.length) {
  console.error('hnsw candidate set test failed: expected hits for large candidate set');
  process.exit(1);
}
if (largeHits.some((hit) => !largeCandidates.has(hit.idx))) {
  console.error('hnsw candidate set test failed: large candidate set filtering failed');
  process.exit(1);
}
if (largeHits.length > 1 && largeHits[0].sim < largeHits[1].sim) {
  console.error('hnsw candidate set test failed: large set results not sorted by similarity');
  process.exit(1);
}

console.log('hnsw candidate set test passed');
