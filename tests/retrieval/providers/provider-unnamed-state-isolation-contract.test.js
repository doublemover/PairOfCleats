#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

let primaryPreflightCalls = 0;
let fallbackPreflightCalls = 0;
let fallbackQueryCalls = 0;

const primaryProvider = {
  isAvailable: () => true,
  preflight: async () => {
    primaryPreflightCalls += 1;
    return false;
  },
  query: async () => []
};

const fallbackProvider = {
  isAvailable: () => true,
  preflight: async () => {
    fallbackPreflightCalls += 1;
    return true;
  },
  query: async () => {
    fallbackQueryCalls += 1;
    return [{ idx: 0, sim: 0.97 }];
  }
};

const { context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([
    [ANN_PROVIDER_IDS.HNSW, primaryProvider],
    [ANN_PROVIDER_IDS.DENSE, fallbackProvider]
  ])
});
context.annBackend = 'auto';

const pipeline = createSearchPipeline(context);
const results = await pipeline(idx, 'code', [0.1, 0.2]);

assert.ok(Array.isArray(results) && results.length > 0, 'expected non-empty results');
assert.equal(primaryPreflightCalls, 1, 'expected primary unnamed provider preflight to run once');
assert.equal(
  fallbackPreflightCalls,
  1,
  'expected fallback unnamed provider preflight not to inherit failure state'
);
assert.equal(fallbackQueryCalls, 1, 'expected fallback unnamed provider query to run');
assert.ok(
  results.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE),
  'expected dense provider results after primary preflight failure'
);

console.log('provider unnamed state isolation contract test passed');
