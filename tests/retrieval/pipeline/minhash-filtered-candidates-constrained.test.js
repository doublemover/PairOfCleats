#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createFilteredMinhashPipelineFixture } from './helpers/minhash-filtered-fixture.js';

const provider = {
  id: ANN_PROVIDER_IDS.DENSE,
  isAvailable: () => true,
  query: async () => []
};

const { idx, pipeline, stageTracker } = createFilteredMinhashPipelineFixture({
  provider,
  topN: 1
});

const results = await pipeline(idx, 'code', [0.2, 0.3]);

assert.ok(results.length > 0, 'expected filtered minhash fallback to return in-filter hits');
assert.ok(results.every((entry) => entry.file.endsWith('.js')), 'expected minhash candidates to stay within active filter cohort');
assert.ok(!results.some((entry) => entry.file.endsWith('.ts')), 'did not expect out-of-filter minhash result');

const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
assert.equal(
  annStage?.candidatePolicy?.reason,
  'filtersActiveAllowedIdx',
  'expected filtersActiveAllowedIdx candidate-policy path'
);
assert.equal(annStage?.source, 'minhash', 'expected minhash fallback to be selected');

console.log('minhash filtered candidates constrained test passed');
