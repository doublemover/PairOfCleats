#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveHnswTarget } from '../../../src/shared/hnsw.js';

assert.equal(resolveHnswTarget('code', 'auto'), 'code');
assert.equal(resolveHnswTarget('prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('extracted-prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('records', 'auto'), 'merged');
assert.equal(resolveHnswTarget('code', 'doc'), 'doc');
assert.equal(resolveHnswTarget('prose', 'code'), 'code');
assert.equal(resolveHnswTarget('code', 'merged'), 'merged');
assert.equal(resolveHnswTarget('code', ''), 'merged');

console.log('hnsw target selection tests passed');
