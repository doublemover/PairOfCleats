#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { normalizeIndexOptimizationProfile } from '../../../src/index/build/runtime/runtime.js';

ensureTestingEnv(process.env);

assert.equal(normalizeIndexOptimizationProfile(undefined), 'default');
assert.equal(normalizeIndexOptimizationProfile('default'), 'default');
assert.equal(normalizeIndexOptimizationProfile('throughput'), 'throughput');
assert.equal(normalizeIndexOptimizationProfile('memory-saver'), 'memory-saver');
assert.equal(normalizeIndexOptimizationProfile(' MEMORY-SAVER '), 'memory-saver');
assert.equal(normalizeIndexOptimizationProfile('unknown-profile'), 'default');

console.log('index optimization profile normalization test passed');
