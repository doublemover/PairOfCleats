#!/usr/bin/env node
import { createIndexState } from '../../../src/index/build/state.js';
import { createTokenRetentionState } from '../../../src/index/build/indexer/steps/postings.js';

const runtime = {
  userConfig: {
    indexing: {
      chunkTokenMode: 'auto',
      chunkTokenMaxTokens: 5,
      chunkTokenSampleSize: 2
    }
  },
  postingsConfig: {},
  embeddingEnabled: false
};

const state = createIndexState();
const { appendChunkWithRetention } = createTokenRetentionState({
  runtime,
  totalFiles: 1,
  log: () => {}
});

appendChunkWithRetention(state, {
  file: 'alpha.js',
  tokens: ['a', 'b', 'c'],
  seq: ['a', 'b', 'c'],
  docmeta: {},
  stats: {},
  minhashSig: [1, 2]
}, state);

appendChunkWithRetention(state, {
  file: 'beta.js',
  tokens: ['d', 'e', 'f', 'g'],
  seq: ['d', 'e', 'f', 'g'],
  docmeta: {},
  stats: {},
  minhashSig: [3, 4]
}, state);

const tokensA = state.chunks[0]?.tokens || [];
const tokensB = state.chunks[1]?.tokens || [];

if (tokensA.length > 2 || tokensB.length > 2) {
  console.error('chunk retention sampling test failed: tokens not sampled after threshold.');
  process.exit(1);
}

console.log('chunk retention sampling test passed');
