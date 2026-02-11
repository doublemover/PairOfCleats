#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { hashTokenId } from '../../../src/shared/token-id.js';

const chunks = [
  { file: 'a.js', tokens: ['alpha', 'beta', 'alpha', 'gamma'] },
  { file: 'b.js', tokens: ['beta', 'delta', 'alpha'] },
  { file: 'c.js', tokens: ['epsilon', 'alpha', 'beta', 'beta'] }
];

const buildStateAndPostings = async (typed) => {
  const state = createIndexState({ postingsConfig: { typed } });
  for (const entry of chunks) {
    const tokenIds = entry.tokens.map((token) => hashTokenId(token));
    appendChunk(state, {
      file: entry.file,
      tokens: entry.tokens,
      tokenIds,
      seq: entry.tokens
    }, { typed });
  }
  return buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    tokenIdMap: state.tokenIdMap,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig: { typed },
    postingsGuard: state.postingsGuard,
    embeddingsEnabled: false
  });
};

const baseline = await buildStateAndPostings(false);
const typed = await buildStateAndPostings(true);

assert.deepEqual(typed.tokenVocab, baseline.tokenVocab, 'token vocab mismatch');
assert.deepEqual(typed.tokenVocabIds, baseline.tokenVocabIds, 'token vocab ids mismatch');
assert.deepEqual(typed.tokenPostingsList, baseline.tokenPostingsList, 'token postings mismatch');
assert.deepEqual(typed.docLengths, baseline.docLengths, 'doc lengths mismatch');

console.log('postings typed-map parity test passed');
