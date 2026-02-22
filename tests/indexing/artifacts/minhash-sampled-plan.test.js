#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  minifyMinhashSignature,
  resolveMinhashSampledPlan
} from '../../../src/index/minhash.js';

const plan = resolveMinhashSampledPlan({
  totalDocs: 5000,
  maxDocs: 1000,
  signatureLength: 128
});

assert.ok(plan, 'expected sampled plan for oversized corpus');
assert.equal(plan.mode, 'sampled-minified', 'expected sampled mode');
assert.equal(plan.hashStride, 5, 'expected stride to follow oversubscription ratio');
assert.equal(plan.sampledSignatureLength, 26, 'expected reduced sampled signature length');

const fullSignature = Array.from({ length: 128 }, (_value, idx) => idx + 1);
const sampled = minifyMinhashSignature(fullSignature, plan);
assert.equal(sampled.length, plan.sampledSignatureLength, 'expected minified signature length');
assert.deepEqual(
  sampled.slice(0, 6),
  [1, 6, 11, 16, 21, 26],
  'expected deterministic stride sampling order'
);

const unchangedPlan = resolveMinhashSampledPlan({
  totalDocs: 100,
  maxDocs: 1000,
  signatureLength: 128
});
assert.equal(unchangedPlan, null, 'expected no sampled plan under max-doc limit');

console.log('minhash sampled plan test passed');
