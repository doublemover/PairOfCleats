#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveLanceDbTarget } from '../../../src/shared/lancedb.js';
import { resolveHnswTarget } from '../../../src/shared/hnsw.js';

assert.equal(resolveLanceDbTarget('code', 'auto'), 'code');
assert.equal(resolveLanceDbTarget('prose', 'auto'), 'doc');
assert.equal(resolveLanceDbTarget('extracted-prose', 'auto'), 'doc');
assert.equal(resolveLanceDbTarget('records', 'auto'), 'merged');
assert.equal(resolveLanceDbTarget('code', 'doc'), 'doc');
assert.equal(resolveLanceDbTarget('prose', 'code'), 'code');
assert.equal(resolveLanceDbTarget('code', 'merged'), 'merged');

assert.equal(resolveHnswTarget('code', 'auto'), 'code');
assert.equal(resolveHnswTarget('prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('extracted-prose', 'auto'), 'doc');
assert.equal(resolveHnswTarget('records', 'auto'), 'merged');

console.log('ann backend selection tests passed');
