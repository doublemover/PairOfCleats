#!/usr/bin/env node
import { buildPostings } from '../../../src/index/build/postings.js';

const chunks = [
  { tokens: ['alpha'], tokenCount: 1, minhashSig: [1, 2] },
  { tokens: ['beta'], tokenCount: 1, minhashSig: [3, 4] }
];

const tokenPostings = new Map([
  ['alpha', [[0, 1]]],
  ['beta', [[1, 1]]]
]);

const phrasePost = new Map([
  ['alpha beta', [0, 1]]
]);

const triPost = new Map([
  ['alp', [0]],
  ['bet', [1]]
]);

const fieldPostings = {
  name: new Map([['alpha', [[0, 1]]]]),
  signature: new Map(),
  doc: new Map(),
  comment: new Map(),
  body: new Map([['beta', [[1, 1]]]]),
  keyword: new Map(),
  operator: new Map(),
  literal: new Map()
};

const fieldDocLengths = {
  name: [1, 0],
  signature: [0, 0],
  doc: [0, 0],
  comment: [0, 0],
  body: [0, 1],
  keyword: [0, 0],
  operator: [0, 0],
  literal: [0, 0]
};

await buildPostings({
  chunks,
  df: new Map(),
  tokenPostings,
  docLengths: [1, 1],
  fieldPostings,
  fieldDocLengths,
  phrasePost,
  triPost,
  postingsConfig: {},
  modelId: 'test',
  useStubEmbeddings: true,
  log: () => {},
  workerPool: null,
  embeddingsEnabled: false
});

if (tokenPostings.size !== 0) {
  console.error('postings heap plateau test failed: tokenPostings not cleared.');
  process.exit(1);
}
if (phrasePost.size !== 0) {
  console.error('postings heap plateau test failed: phrasePost not cleared.');
  process.exit(1);
}
if (triPost.size !== 0) {
  console.error('postings heap plateau test failed: triPost not cleared.');
  process.exit(1);
}
for (const [field, map] of Object.entries(fieldPostings)) {
  if (map && typeof map.size === 'number' && map.size !== 0) {
    console.error(`postings heap plateau test failed: fieldPostings ${field} not cleared.`);
    process.exit(1);
  }
}

console.log('postings heap plateau test passed');
