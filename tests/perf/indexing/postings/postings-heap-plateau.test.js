#!/usr/bin/env node
import { buildIndexPostings } from '../../../../src/index/build/indexer/steps/postings.js';

const chunks = [
  {
    tokens: ['alpha'],
    tokenCount: 1,
    minhashSig: [1, 2],
    embedding: [0.1, 0.2],
    embed_doc: [],
    embed_code: [0.3, 0.4]
  },
  {
    tokens: ['beta'],
    tokenCount: 1,
    minhashSig: [3, 4],
    embedding: [0.5, 0.6],
    embed_doc: [0.7, 0.8],
    embed_code: [0.9, 1.0]
  }
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

await buildIndexPostings({
  runtime: {
    postingsConfig: {},
    buildRoot: null,
    modelId: 'test',
    useStubEmbeddings: true,
    workerPool: null,
    quantizePool: null,
    embeddingEnabled: false,
    stage: 'stage1'
  },
  state: {
    chunks,
    df: new Map(),
    tokenPostings,
    tokenIdMap: new Map(),
    docLengths: [1, 1],
    fieldPostings,
    fieldDocLengths,
    phrasePost,
    triPost,
    postingsGuard: null
  }
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

for (const chunk of chunks) {
  if (chunk && typeof chunk === 'object' && ('embedding' in chunk || 'embed_doc' in chunk || 'embed_code' in chunk)) {
    console.error('postings heap plateau test failed: float embeddings not cleared from chunk.');
    process.exit(1);
  }
}

console.log('postings heap plateau test passed');
