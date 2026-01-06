#!/usr/bin/env node
import { buildPostings } from '../src/index/build/postings.js';
import { quantizeVec } from '../src/index/embedding.js';

const chunks = [
  {
    tokens: ['a'],
    embedding: [0.1, 0.2],
    embed_doc: [0.3, 0.4],
    embed_code: [0.5, 0.6],
    minhashSig: [1, 2]
  },
  {
    tokens: ['b'],
    embedding: [0.7, 0.8],
    minhashSig: [3, 4]
  }
];

const tokenPostings = new Map([
  ['a', [[0, 1]]],
  ['b', [[1, 1]]]
]);

const postings = await buildPostings({
  chunks,
  df: new Map(),
  tokenPostings,
  docLengths: [1, 1],
  fieldPostings: null,
  fieldDocLengths: null,
  phrasePost: new Map(),
  triPost: new Map(),
  postingsConfig: {},
  modelId: 'test',
  useStubEmbeddings: true,
  log: () => {},
  workerPool: null,
  embeddingsEnabled: true
});

const expectedMerged = chunks.map((chunk) => quantizeVec(chunk.embedding));
const expectedDoc = chunks.map((chunk) => quantizeVec(chunk.embed_doc || chunk.embedding));
const expectedCode = chunks.map((chunk) => quantizeVec(chunk.embed_code || chunk.embedding));

const equal = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`postings quantize test failed: ${label}`);
    process.exit(1);
  }
};

equal('dense', postings.quantizedVectors, expectedMerged);
equal('doc', postings.quantizedDocVectors, expectedDoc);
equal('code', postings.quantizedCodeVectors, expectedCode);

console.log('postings quantize test passed');
