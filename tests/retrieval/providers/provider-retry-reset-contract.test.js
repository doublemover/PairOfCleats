#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

let preflightCalls = 0;
let queryCalls = 0;

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  preflight: async () => {
    preflightCalls += 1;
    return preflightCalls > 1;
  },
  query: async () => {
    queryCalls += 1;
    return [{ idx: 0, sim: 0.99 }];
  }
};

const { stageTracker, context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
});
const pipeline = createSearchPipeline(context);

const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;

let run1 = null;
let run2 = null;
let run3 = null;
try {
  run1 = await pipeline(idx, 'code', [0.1, 0.2]);
  run2 = await pipeline(idx, 'code', [0.1, 0.2]);
  now += 1500;
  run3 = await pipeline(idx, 'code', [0.1, 0.2]);
} finally {
  Date.now = originalNow;
}

assert.ok(Array.isArray(run1) && run1.length > 0, 'expected sparse fallback results on first run');
assert.ok(Array.isArray(run2) && run2.length > 0, 'expected sparse fallback results during cooldown');
assert.ok(Array.isArray(run3) && run3.length > 0, 'expected results after provider retry');
assert.equal(preflightCalls, 2, 'expected provider preflight to retry after cooldown');
assert.equal(queryCalls, 1, 'expected provider query once after successful preflight reset');
assert.ok(run3.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE), 'expected ANN source after retry');
assert.ok(run3.some((entry) => entry.annType === 'vector'), 'expected annType to reflect vector source');

const annStages = stageTracker.stages.filter((entry) => entry.stage === 'ann');
assert.ok(annStages.length >= 3, 'expected ann stage telemetry for each run');

console.log('provider retry reset contract test passed');
