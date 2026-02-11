#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { hashTokenId } from '../../../src/shared/token-id.js';

const docs = [
  { file: 'a.js', tokens: ['alpha', 'beta', 'gamma', 'delta'] },
  { file: 'b.js', tokens: ['alpha', 'beta', 'epsilon', 'delta'] }
];

const build = async (phraseHash) => {
  const postingsConfig = {
    phraseSource: 'full',
    phraseMinN: 2,
    phraseMaxN: 3,
    phraseHash
  };
  const state = createIndexState({ postingsConfig });
  for (const doc of docs) {
    const tokenIds = doc.tokens.map((token) => hashTokenId(token));
    appendChunk(state, {
      file: doc.file,
      tokens: doc.tokens,
      tokenIds,
      seq: doc.tokens
    }, postingsConfig);
  }
  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    tokenIdMap: state.tokenIdMap,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    phrasePostHashBuckets: state.phrasePostHashBuckets,
    triPost: state.triPost,
    postingsConfig,
    postingsGuard: state.postingsGuard,
    embeddingsEnabled: false
  });
  return { state, postings };
};

const baseline = await build(false);
const hashed = await build(true);

assert.equal(
  hashed.state.phrasePost.size,
  0,
  'expected legacy phrase map to remain unused when phraseHash is enabled'
);
assert.deepEqual(
  hashed.postings.phraseVocab,
  baseline.postings.phraseVocab,
  'phrase vocab mismatch'
);
assert.deepEqual(
  hashed.postings.phrasePostings,
  baseline.postings.phrasePostings,
  'phrase postings mismatch'
);

console.log('phrase hash parity test passed');
