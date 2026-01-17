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
  },
  {
    tokens: ['c'],
    embedding: [0.9, 0.1],
    embed_doc: [],
    minhashSig: [5, 6]
  },
  {
    tokens: ['d'],
    embedding: [0.2, 0.4, 0.6],
    minhashSig: [7, 8]
  }
];

const tokenPostings = new Map([
  ['a', [[0, 1]]],
  ['b', [[1, 1]]],
  ['c', [[2, 1]]],
  ['d', [[3, 1]]]
]);

const postings = await buildPostings({
  chunks,
  df: new Map(),
  tokenPostings,
  docLengths: [1, 1, 1, 1],
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

const dims = chunks[0].embedding.length;
const normalize = (vec) => {
  if (!Array.isArray(vec)) return new Array(dims).fill(0);
  if (vec.length === dims) return vec;
  if (vec.length > dims) return vec.slice(0, dims);
  const out = vec.slice();
  while (out.length < dims) out.push(0);
  return out;
};

const expectedMerged = chunks.map((chunk) => quantizeVec(normalize(chunk.embedding)));
const expectedDoc = chunks.map((chunk) => {
  if (Array.isArray(chunk.embed_doc)) {
    return chunk.embed_doc.length
      ? quantizeVec(normalize(chunk.embed_doc))
      : quantizeVec(new Array(dims).fill(0));
  }
  return quantizeVec(normalize(chunk.embedding));
});
const expectedCode = chunks.map((chunk) => (
  Array.isArray(chunk.embed_code) && chunk.embed_code.length
    ? quantizeVec(normalize(chunk.embed_code))
    : quantizeVec(normalize(chunk.embedding))
));

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
