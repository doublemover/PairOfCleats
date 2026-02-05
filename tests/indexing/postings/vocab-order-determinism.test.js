#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { createOrderingHasher } from '../../../src/shared/order.js';

const buildVocab = async (tokens) => {
  const state = createIndexState();
  appendChunk(state, { tokens, seq: tokens, file: 'sample.txt' }, {});
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
  return postings.tokenVocab;
};

const vocabA = await buildVocab(['delta', 'alpha', 'beta']);
const vocabB = await buildVocab(['beta', 'delta', 'alpha']);

assert.deepEqual(vocabA, vocabB, 'token vocab ordering should be deterministic');

const hashVocab = (vocab) => {
  const hasher = createOrderingHasher();
  for (const entry of vocab) hasher.update(entry);
  return hasher.digest().hash;
};

assert.equal(hashVocab(vocabA), hashVocab(vocabB), 'vocab ordering hash should match');

console.log('vocab order determinism test passed');
