#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createFilteredMinhashPipelineFixture } from './helpers/minhash-filtered-fixture.js';

const providerCandidateSizes = [];
const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query: async ({ candidateSet }) => {
    providerCandidateSizes.push(candidateSet instanceof Set ? candidateSet.size : null);
    return [];
  }
};

const { idx, pipeline, stageTracker } = createFilteredMinhashPipelineFixture({
  provider,
  topN: 2
});

await pipeline(idx, 'code', [0.1, 0.2]);

assert.deepEqual(
  providerCandidateSizes,
  [3],
  'expected ANN policy to query provider with oversized filtered fallback set'
);

const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
assert.equal(
  annStage?.candidatePolicy?.reason,
  'filtersActiveAllowedIdx',
  'expected ann candidate policy to promote undersized BM set to allowedIdx under filters'
);
assert.equal(
  annStage?.source,
  'minhash',
  'expected minhash fallback to still run on BM subset when allowedIdx fallback exceeds minhashMaxDocs'
);
assert.ok(
  Number.isFinite(annStage?.hits) && annStage.hits > 0,
  'expected minhash fallback hits for BM-constrained filtered set'
);

console.log('minhash filtered oversized fallback test passed');
