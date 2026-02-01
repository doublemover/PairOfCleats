#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveDenseVector } from '../../../src/retrieval/cli/index-loader.js';
import { resolveIntentVectorMode } from '../../../src/retrieval/query-intent.js';

const makeIdx = () => ({
  denseVec: { label: 'merged' },
  denseVecDoc: { label: 'doc' },
  denseVecCode: { label: 'code' }
});

const idx = makeIdx();
assert.equal(resolveDenseVector(idx, 'code', 'code')?.label, 'code');
assert.equal(resolveDenseVector(idx, 'prose', 'doc')?.label, 'doc');
assert.equal(resolveDenseVector(idx, 'code', 'merged')?.label, 'merged');
assert.equal(resolveDenseVector(idx, 'code', 'auto')?.label, 'code');
assert.equal(resolveDenseVector(idx, 'prose', 'auto')?.label, 'doc');

const fallbackIdx = { denseVec: { label: 'merged' } };
assert.equal(resolveDenseVector(fallbackIdx, 'code', 'code')?.label, 'merged');
assert.equal(resolveDenseVector(fallbackIdx, 'prose', 'doc')?.label, 'merged');

assert.equal(resolveIntentVectorMode('auto', { vectorMode: 'doc' }), 'doc');
assert.equal(resolveIntentVectorMode('auto', { vectorMode: null }), 'auto');
assert.equal(resolveIntentVectorMode('code', { vectorMode: 'doc' }), 'code');

console.log('dense vector mode tests passed');
