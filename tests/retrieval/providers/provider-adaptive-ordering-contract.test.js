#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

let primaryCalls = 0;
let fallbackCalls = 0;

const primaryProvider = {
  id: ANN_PROVIDER_IDS.LANCEDB,
  isAvailable: () => true,
  preflight: async () => true,
  query: async () => {
    primaryCalls += 1;
    if (primaryCalls === 1) throw new Error('transient provider failure');
    return [{ idx: 0, sim: 0.95 }];
  }
};

const fallbackProvider = {
  id: ANN_PROVIDER_IDS.SQLITE_VECTOR,
  isAvailable: () => true,
  preflight: async () => true,
  query: async () => {
    fallbackCalls += 1;
    return [{ idx: 1, sim: 0.94 }];
  }
};

const { context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([
    [ANN_PROVIDER_IDS.LANCEDB, primaryProvider],
    [ANN_PROVIDER_IDS.SQLITE_VECTOR, fallbackProvider]
  ])
});
idx.state = { profile: { id: INDEX_PROFILE_VECTOR_ONLY } };
context.annBackend = 'auto';
context.annAdaptiveProviders = true;

const pipeline = createSearchPipeline(context);

const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;

let run1 = null;
let run2 = null;
try {
  run1 = await pipeline(idx, 'code', [0.1, 0.2]);
  now += 1100; // advance past retry cooldown so adaptive ordering controls selection
  run2 = await pipeline(idx, 'code', [0.1, 0.2]);
} finally {
  Date.now = originalNow;
}

assert.ok(Array.isArray(run1) && run1.length > 0, 'expected fallback results when primary provider fails');
assert.ok(Array.isArray(run2) && run2.length > 0, 'expected ANN results after adaptive provider ordering');
assert.equal(primaryCalls, 1, 'expected adaptive ordering to avoid retrying degraded provider immediately');
assert.equal(fallbackCalls, 2, 'expected fallback provider to handle both queries');
assert.ok(
  run2.some((entry) => entry.annSource === ANN_PROVIDER_IDS.SQLITE_VECTOR),
  'expected adaptive run to source ANN hits from fallback provider'
);

console.log('provider adaptive ordering contract test passed');
