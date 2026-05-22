#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

const pipeline = createSearchPipelineFixture({
  annEnabled: true,
  profilePolicyByMode: {
    prose: {
      profileId: 'vector_only',
      vectorOnly: true,
      allowSparseFallback: false
    }
  },
  createAnnProviders: () => new Map([
    [ANN_PROVIDER_IDS.DENSE, {
      id: ANN_PROVIDER_IDS.DENSE,
      isAvailable: () => true,
      preflight: async () => true,
      query: async () => []
    }]
  ])
});

const idx = createAlphaSearchIndex({
  chunks: [{ id: 0, file: 'src/doc.md', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null,
  denseVec: { vectors: [new Uint8Array([1])], dims: 1, model: 'stub' }
});

const results = await pipeline(idx, 'prose', [0.1]);
assert.deepEqual(results, [], 'expected vector_only search with empty ANN hits to return no results (not capability error)');

console.log('vector-only empty ann results do not fail test passed');
