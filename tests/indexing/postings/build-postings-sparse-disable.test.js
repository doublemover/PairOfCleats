#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildPostings } from '../../../src/index/build/postings.js';

process.env.PAIROFCLEATS_TESTING = '1';

const chunks = [
  {
    file: 'src/a.js',
    tokens: ['alpha', 'beta'],
    tokenIds: [11, 22],
    minhashSig: [1, 2, 3]
  }
];

const tokenPostings = new Map();
tokenPostings.set(11, [[0, 1]]);
tokenPostings.set(22, [[0, 1]]);

const tokenIdMap = new Map([
  [11, 'alpha'],
  [22, 'beta']
]);

const phrasePost = new Map();
phrasePost.set('alpha\u0001beta', [0]);

const triPost = new Map();
triPost.set('h64:abc', [0]);

const fieldPostings = {
  name: new Map([['alpha', [[0, 1]]]])
};
const fieldDocLengths = {
  name: [1]
};

const postings = await buildPostings({
  chunks,
  df: new Map(),
  tokenPostings,
  tokenIdMap,
  docLengths: [2],
  fieldPostings,
  fieldDocLengths,
  phrasePost,
  triPost,
  postingsConfig: {
    fielded: true,
    enablePhraseNgrams: true,
    enableChargrams: true,
    minhashStream: false
  },
  embeddingsEnabled: false,
  sparsePostingsEnabled: false,
  modelId: 'stub',
  useStubEmbeddings: true,
  log: () => {}
});

assert.deepEqual(postings.tokenVocab, [], 'sparse-disabled build should omit token vocab');
assert.deepEqual(postings.tokenVocabIds, [], 'sparse-disabled build should omit token vocab ids');
assert.deepEqual(postings.tokenPostingsList, [], 'sparse-disabled build should omit token postings');
assert.deepEqual(postings.phraseVocab, [], 'sparse-disabled build should omit phrase vocab');
assert.deepEqual(postings.phrasePostings, [], 'sparse-disabled build should omit phrase postings');
assert.deepEqual(postings.chargramVocab, [], 'sparse-disabled build should omit chargram vocab');
assert.deepEqual(postings.chargramPostings, [], 'sparse-disabled build should omit chargram postings');
assert.equal(postings.fieldPostings, null, 'sparse-disabled build should omit field postings');
assert.deepEqual(postings.minhashSigs, [], 'sparse-disabled build should omit minhash signatures');
assert.equal(postings.minhashStream, false, 'sparse-disabled build should disable minhash streaming');

console.log('build postings sparse disable test passed');
