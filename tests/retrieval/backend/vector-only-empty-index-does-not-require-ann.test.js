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

const idx = createAlphaSearchIndex({ chunks: [], tokenIndex: null });

const results = await pipeline(idx, 'prose', null);
assert.deepEqual(results, [], 'expected empty vector-only indexes to return no results');

console.log('vector-only empty index does not require ann test passed');
