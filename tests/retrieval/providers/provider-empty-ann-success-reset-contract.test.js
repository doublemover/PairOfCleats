#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

let queryCalls = 0;

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  preflight: async () => true,
  query: async () => {
    queryCalls += 1;
    if (queryCalls === 1) throw new Error('transient ann error #1');
    if (queryCalls === 2) return [];
    if (queryCalls === 3) throw new Error('transient ann error #2');
    return [{ idx: 0, sim: 0.95 }];
  }
};

const { context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
});
const pipeline = createSearchPipeline(context);

const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;

let run1 = null;
let run2 = null;
let run3 = null;
let run4 = null;
let run5 = null;
try {
  run1 = await pipeline(idx, 'code', [0.1, 0.2]);
  run2 = await pipeline(idx, 'code', [0.1, 0.2]);
  now += 1100;
  run3 = await pipeline(idx, 'code', [0.1, 0.2]);
  run4 = await pipeline(idx, 'code', [0.1, 0.2]);
  now += 1100;
  run5 = await pipeline(idx, 'code', [0.1, 0.2]);
} finally {
  Date.now = originalNow;
}

assert.ok(Array.isArray(run1) && run1.length > 0, 'expected sparse fallback after initial ANN failure');
assert.ok(Array.isArray(run2) && run2.length > 0, 'expected sparse fallback during first cooldown');
assert.ok(Array.isArray(run3) && run3.length > 0, 'expected sparse fallback when ANN returns empty result');
assert.ok(Array.isArray(run4) && run4.length > 0, 'expected sparse fallback after second ANN failure');
assert.ok(Array.isArray(run5) && run5.length > 0, 'expected results on retry after second failure');
assert.equal(queryCalls, 4, 'expected retry cadence to reset after empty-result ANN success');
assert.ok(run5.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE), 'expected ANN source after second retry');

console.log('provider empty ANN success reset contract test passed');
