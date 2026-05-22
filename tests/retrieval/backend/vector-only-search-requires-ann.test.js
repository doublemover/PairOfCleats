#!/usr/bin/env node
import assert from 'node:assert/strict';
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
  }
});

const idx = createAlphaSearchIndex({
  chunks: [{ id: 0, file: 'src/doc.md', tokens: ['alpha'], weight: 1 }],
  tokenIndex: null
});

let failed = false;
try {
  await pipeline(idx, 'prose', null);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'CAPABILITY_MISSING', 'expected controlled capability error');
  assert.equal(err?.reasonCode, 'retrieval_vector_required', 'expected vector-required reason code');
  assert.match(String(err?.message || err), /Vector-only search requires ANN/i);
}

if (!failed) {
  throw new Error('Expected vector-only search to fail when ANN providers are unavailable');
}

console.log('vector-only search requires ann test passed');
