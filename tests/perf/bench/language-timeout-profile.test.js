#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveBenchProcessTimeoutProfile,
  resolveBenchRuntimeAdaptationPlan
} from '../../../tools/bench/language/timeout.js';

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

const adapted = resolveBenchRuntimeAdaptationPlan({
  repoTimeoutMs: 30 * 60 * 1000,
  language: 'starlark',
  buildIndex: true,
  buildSqlite: true,
  realEmbeddings: true,
  lineStats: {
    totals: {
      code: 3_400_000,
      prose: 25_000,
      'extracted-prose': 12_000,
      records: 0
    },
    linesByFile: {
      code: {},
      prose: {},
      'extracted-prose': {},
      records: {}
    }
  }
});
assert.equal(adapted.repoShape.tier, 'xlarge', 'expected very large repo shape classification');
assert.equal(adapted.repoShape.heavyLanguage, true, 'expected heavy-language classification');
assert.equal(adapted.adapted, true, 'expected adaptive timeout plan for large build repo');
assert.equal(adapted.recommendedThreads, 2, 'expected xlarge heavy repo thread cap recommendation');
assert.ok(adapted.repoTimeoutMs > 30 * 60 * 1000, 'expected adaptive timeout budget to exceed baseline');

console.log('bench language timeout profile test passed');
