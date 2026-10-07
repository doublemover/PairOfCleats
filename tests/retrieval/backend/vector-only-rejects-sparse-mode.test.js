#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

const pipeline = createSearchPipelineFixture({
  profilePolicyByMode: {
    code: {
      profileId: 'vector_only',
      vectorOnly: true,
      allowSparseFallback: false
    }
  }
});

const idx = createAlphaSearchIndex({ tokenIndex: null });

let failed = false;
try {
  await pipeline(idx, 'code', null);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'INVALID_REQUEST', 'expected controlled invalid-request error');
  assert.equal(err?.reasonCode, 'retrieval_profile_mismatch', 'expected profile mismatch reason code');
  assert.match(String(err?.message || err), /allow-sparse-fallback/i);
}

if (!failed) {
  throw new Error('Expected vector-only sparse-only mode to be rejected');
}

console.log('vector-only rejects sparse mode test passed');
