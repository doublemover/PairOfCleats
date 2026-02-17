#!/usr/bin/env node
import assert from 'node:assert/strict';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { createIndexState } from '../../../src/index/build/state.js';
import { createTokenRetentionState } from '../../../src/index/build/indexer/steps/postings.js';

const logs = [];
const runtime = {
  profile: { id: INDEX_PROFILE_VECTOR_ONLY },
  indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY },
  userConfig: {
    indexing: {
      profile: INDEX_PROFILE_VECTOR_ONLY,
      chunkTokenMode: 'auto',
      chunkTokenMaxFiles: 1,
      chunkTokenMaxTokens: 2,
      chunkTokenSampleSize: 1
    }
  },
  postingsConfig: {},
  embeddingEnabled: false
};

const state = createIndexState();
const { appendChunkWithRetention } = createTokenRetentionState({
  runtime,
  totalFiles: 50,
  sparsePostingsEnabled: false,
  log: (message) => logs.push(message)
});

appendChunkWithRetention(state, {
  file: 'alpha.js',
  tokens: ['alpha', 'beta'],
  seq: ['alpha', 'beta'],
  docmeta: {},
  stats: {},
  minhashSig: [1, 2]
}, state);

appendChunkWithRetention(state, {
  file: 'beta.js',
  tokens: ['gamma', 'delta'],
  seq: ['gamma', 'delta'],
  docmeta: {},
  stats: {},
  minhashSig: [3, 4]
}, state);

assert.deepEqual(
  state.chunks[0]?.tokens,
  ['alpha', 'beta'],
  'expected vector_only auto mode to keep full tokens for first chunk'
);
assert.deepEqual(
  state.chunks[1]?.tokens,
  ['gamma', 'delta'],
  'expected vector_only auto mode to keep full tokens for second chunk'
);
assert.equal(
  logs.length,
  0,
  'expected vector_only auto mode to skip token-budget auto->sample downgrades'
);

console.log('chunk retention vector_only auto full test passed');
