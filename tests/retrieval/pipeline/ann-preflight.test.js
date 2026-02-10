#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

let preflightCalls = 0;
let queryCalls = 0;

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  preflight: async () => {
    preflightCalls += 1;
    return false;
  },
  query: async () => {
    queryCalls += 1;
    return [{ idx: 0, sim: 0.9 }];
  }
};
const scenario = 'ann-provider-preflight-failure-fallback';
const { stageTracker, context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
});
const pipeline = createSearchPipeline(context);

const realDateNow = Date.now;
let nowMs = realDateNow();
Date.now = () => nowMs;
let results = [];
let resultsAgain = [];
try {
  results = await pipeline(idx, 'code', [0.1, 0.2]);
  // Advance beyond provider cooldown window but within preflight cache TTL.
  nowMs += 1500;
  resultsAgain = await pipeline(idx, 'code', [0.1, 0.2]);
} finally {
  Date.now = realDateNow;
}

assert.ok(results.length > 0, 'expected sparse fallback results');
assert.ok(resultsAgain.length > 0, 'expected sparse fallback results on second run');
assert.equal(preflightCalls, 1, 'expected preflight to be reused from cache after failure');
assert.equal(queryCalls, 0, 'expected ANN query to be skipped after preflight failure');

const annStages = stageTracker.stages.filter((entry) => entry.stage === 'ann');
const lastAnnStage = annStages[annStages.length - 1];
assert.ok(lastAnnStage, 'expected ann stage to be recorded');
assert.equal(lastAnnStage.warned, true, 'expected ann fallback warning');
assert.equal(lastAnnStage.providerAvailable, false, 'expected provider to be unavailable after preflight failure');

console.log(`${scenario} test passed`);
