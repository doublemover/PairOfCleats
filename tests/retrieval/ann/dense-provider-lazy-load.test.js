#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createDenseAnnProvider } from '../../../src/retrieval/ann/providers/dense.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

const { context, idx } = buildAnnPipelineFixture({
  createAnnProviders: () => new Map([
    [ANN_PROVIDER_IDS.DENSE, createDenseAnnProvider()]
  ])
});
context.annBackend = 'dense';
idx.denseVec = { dims: 2, minVal: -1, maxVal: 1, levels: 256, scale: 1, vectors: null };

let loadCalls = 0;
idx.loadDenseVectors = async () => {
  loadCalls += 1;
  idx.denseVec = {
    dims: 2,
    minVal: -1,
    maxVal: 1,
    levels: 256,
    scale: 1,
    vectors: [
      [0.1, 0.2],
      [0.2, 0.1]
    ]
  };
  return idx.denseVec;
};

const pipeline = createSearchPipeline(context);

const run1 = await pipeline(idx, 'code', [0.1, 0.2]);
const run2 = await pipeline(idx, 'code', [0.1, 0.2]);

assert.ok(Array.isArray(run1) && run1.length > 0, 'expected ANN results after lazy dense load');
assert.ok(Array.isArray(run2) && run2.length > 0, 'expected ANN results on subsequent run');
assert.equal(loadCalls, 1, 'expected dense vectors to load on-demand once');
assert.ok(run1.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE), 'expected dense ANN source');
assert.ok(run2.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE), 'expected dense ANN source');

console.log('dense provider lazy load test passed');
