#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBenchProcessTimeoutProfile } from '../../../tools/bench/language/timeout.js';

const baseline = resolveBenchProcessTimeoutProfile({ repoTimeoutMs: 30 * 60 * 1000 });
assert.equal(baseline.idleTimeoutMs, 30 * 60 * 1000, 'expected idle timeout to match configured repo timeout');
assert.ok(baseline.hardTimeoutMs > baseline.idleTimeoutMs, 'expected hard timeout to exceed idle timeout');

const disabled = resolveBenchProcessTimeoutProfile({ repoTimeoutMs: 0 });
assert.deepEqual(disabled, { idleTimeoutMs: 0, hardTimeoutMs: 0 }, 'expected disabled timeout profile to remain disabled');

const small = resolveBenchProcessTimeoutProfile({
  repoTimeoutMs: 4321,
  hardTimeoutScale: 1.5,
  hardTimeoutPaddingMs: 1000,
  maxHardTimeoutMs: 10000
});
assert.equal(small.idleTimeoutMs, 4321, 'expected explicit repo timeout to be preserved as idle budget');
assert.equal(small.hardTimeoutMs, 6482, 'expected hard timeout to honor scaling and exceed idle budget');

console.log('bench language timeout profile test passed');
