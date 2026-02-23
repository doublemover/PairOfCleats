#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyRunSearchSparseFallbackPolicy } from '../../../src/retrieval/cli/run-search/sparse-fallback-orchestration.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const errorResult = await applyRunSearchSparseFallbackPolicy({
  preflightInput: {},
  reinitInput: {},
  dependencies: {
    resolveRunSearchSparsePreflight: () => ({
      annEnabledEffective: false,
      sparseFallbackForcedByPreflight: false,
      sparseMissingByMode: {},
      error: { message: 'sparse preflight failed', code: 'ERR_SPARSE_PREFLIGHT' }
    }),
    reinitializeBackendAfterSparseFallback: async () => {
      throw new Error('should not reinitialize when preflight fails');
    }
  }
});

assert.equal(errorResult.error.message, 'sparse preflight failed');
assert.equal(errorResult.reinitialized, undefined);

let reinitCalled = false;
const noFallback = await applyRunSearchSparseFallbackPolicy({
  preflightInput: {},
  reinitInput: {},
  dependencies: {
    resolveRunSearchSparsePreflight: () => ({
      annEnabledEffective: true,
      sparseFallbackForcedByPreflight: false,
      sparseMissingByMode: { code: [] }
    }),
    reinitializeBackendAfterSparseFallback: async () => {
      reinitCalled = true;
      return {};
    }
  }
});

assert.equal(noFallback.annEnabledEffective, true);
assert.equal(noFallback.sparseFallbackForcedByPreflight, false);
assert.equal(noFallback.reinitialized, false);
assert.equal(reinitCalled, false);

let syncCalls = 0;
const withFallback = await applyRunSearchSparseFallbackPolicy({
  preflightInput: {},
  reinitInput: {},
  syncAnnFlags: () => { syncCalls += 1; },
  dependencies: {
    resolveRunSearchSparsePreflight: () => ({
      annEnabledEffective: false,
      sparseFallbackForcedByPreflight: true,
      sparseMissingByMode: { code: ['fts'] }
    }),
    reinitializeBackendAfterSparseFallback: async () => ({
      useSqlite: true,
      useLmdb: false,
      backendLabel: 'sqlite',
      backendPolicyInfo: 'policy',
      vectorAnnState: null,
      vectorAnnUsed: false,
      sqliteHelpers: {},
      lmdbHelpers: {}
    })
  }
});

assert.equal(syncCalls, 1);
assert.equal(withFallback.reinitialized, true);
assert.equal(withFallback.backendLabel, 'sqlite');
assert.equal(withFallback.sparseFallbackForcedByPreflight, true);

console.log('run-search sparse fallback orchestration test passed');
