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
      query: async () => {
        throw new Error('query failed');
      }
    }]
  ])
});

const idx = createAlphaSearchIndex({
  chunks: [{ id: 0, file: 'src/doc.md', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null,
  denseVec: { vectors: [new Uint8Array([1])], dims: 1, model: 'stub' }
});

let failed = false;
try {
  await pipeline(idx, 'prose', [0.1]);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'CAPABILITY_MISSING', 'expected controlled capability error');
  assert.equal(err?.reasonCode, 'retrieval_vector_required', 'expected vector-required reason code');
  assert.equal(err?.reason, 'ann_provider_unavailable', 'expected query failure to mark provider unavailable');
  assert.match(String(err?.message || err), /Vector-only search requires ANN/i);
}

if (!failed) {
  throw new Error('Expected vector-only search to fail when ANN query fails');
}

console.log('vector-only ann query failure requires ann test passed');
