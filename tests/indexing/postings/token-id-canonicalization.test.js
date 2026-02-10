#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { hashTokenId } from '../../../src/shared/token-id.js';

const state = createIndexState();
const tokens = ['delta', 'alpha', 'beta', 'alpha'];
const tokenIds = tokens.map((token) => hashTokenId(token));

appendChunk(state, {
  tokens,
  tokenIds,
  seq: tokens,
  file: 'sample.txt'
}, {});

const postings = await buildPostings({
  chunks: state.chunks,
  df: state.df,
  tokenPostings: state.tokenPostings,
  tokenIdMap: state.tokenIdMap,
  docLengths: state.docLengths,
  fieldPostings: state.fieldPostings,
  fieldDocLengths: state.fieldDocLengths,
  phrasePost: state.phrasePost,
  triPost: state.triPost,
  postingsConfig: {},
  postingsGuard: state.postingsGuard,
  embeddingsEnabled: false
});

assert.equal(postings.tokenVocab.length, postings.tokenVocabIds.length, 'token vocab ids length mismatch');
for (let i = 0; i < postings.tokenVocab.length; i += 1) {
  const token = postings.tokenVocab[i];
  assert.equal(postings.tokenVocabIds[i], hashTokenId(token), `token id mismatch for ${token}`);
}

console.log('token id canonicalization test passed');
