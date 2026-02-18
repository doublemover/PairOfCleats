#!/usr/bin/env node
import assert from 'node:assert/strict';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { createIndexState } from '../../../src/index/build/state.js';
import { createTokenRetentionState } from '../../../src/index/build/indexer/steps/postings.js';
import { resolveChunkProcessingFeatureFlags } from '../../../src/index/build/indexer/steps/process-files.js';

const runtime = {
  profile: { id: INDEX_PROFILE_VECTOR_ONLY },
  indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY },
  userConfig: { indexing: {} },
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: true,
    fielded: true
  },
  embeddingEnabled: false
};

const flags = resolveChunkProcessingFeatureFlags(runtime);
const state = createIndexState({ postingsConfig: runtime.postingsConfig });
const { appendChunkWithRetention } = createTokenRetentionState({
  runtime,
  totalFiles: 1,
  sparsePostingsEnabled: flags.sparsePostingsEnabled,
  log: () => {}
});

appendChunkWithRetention(state, {
  file: 'src/example.js',
  tokens: ['alpha', 'beta', 'gamma'],
  seq: ['alpha', 'beta', 'gamma'],
  ngrams: ['alpha beta'],
  chargrams: ['h64:deadbeef'],
  fieldTokens: {
    name: ['example'],
    doc: ['sample', 'doc'],
    body: ['alpha', 'beta', 'gamma']
  },
  docmeta: {},
  stats: {},
  minhashSig: [1, 2]
}, state);

assert.equal(state.chunks.length, 1, 'expected chunk append to succeed');
assert.equal(state.totalTokens, 3, 'expected token totals to still be tracked');
assert.deepEqual(
  state.chunks[0].tokens,
  ['alpha', 'beta', 'gamma'],
  'expected chunk tokens to remain available for vector-only query-AST filtering'
);

assert.equal(state.tokenPostings.size, 0, 'expected token postings accumulation to be skipped');
assert.equal(state.phrasePost.size, 0, 'expected phrase postings accumulation to be skipped');
assert.equal(state.triPost.size, 0, 'expected chargram postings accumulation to be skipped');
assert.equal(state.docLengths.length, 0, 'expected doc lengths accumulation to be skipped');
for (const postingsByField of Object.values(state.fieldPostings)) {
  assert.equal(postingsByField.size, 0, 'expected field postings accumulation to be skipped');
}

console.log('vector-only append skips sparse accumulation test passed');
