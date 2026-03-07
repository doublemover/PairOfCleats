#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ANN_BACKEND_CHOICES,
  normalizeAnnBackend,
  resolveAnnOrder
} from '../../../src/retrieval/ann/normalize-backend.js';

assert.deepEqual(ANN_BACKEND_CHOICES, ['auto', 'lancedb', 'sqlite-vector', 'hnsw', 'js']);

assert.equal(normalizeAnnBackend('sqlite'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('sqlite-extension'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('vector-extension'), 'sqlite-vector');
assert.equal(normalizeAnnBackend('dense'), 'js');
assert.equal(normalizeAnnBackend('js'), 'js');
assert.equal(normalizeAnnBackend('auto'), 'auto');
assert.equal(normalizeAnnBackend('unknown'), 'lancedb');
assert.equal(normalizeAnnBackend('unknown', { strict: true, defaultBackend: null }), null);

assert.deepEqual(resolveAnnOrder('lancedb'), ['lancedb']);
assert.deepEqual(resolveAnnOrder('sqlite-vector'), ['sqlite-vector']);
assert.deepEqual(resolveAnnOrder('hnsw'), ['hnsw']);
assert.deepEqual(resolveAnnOrder('dense'), ['js']);
assert.deepEqual(resolveAnnOrder('auto'), ['lancedb', 'sqlite-vector', 'hnsw', 'js']);

console.log('ann backend normalization parity test passed');
