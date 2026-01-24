#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildPostings } from '../src/index/build/postings.js';

const baseInput = {
  chunks: [
    {
      tokenCount: 0,
      embedding_u8: new Uint8Array([1, 2, 3]),
      embed_code_u8: new Uint8Array([1, 2, 3]),
      embed_doc_u8: new Uint8Array(0)
    }
  ],
  df: new Map(),
  tokenPostings: new Map(),
  docLengths: [0],
  fieldPostings: null,
  fieldDocLengths: null,
  phrasePost: new Map(),
  triPost: new Map(),
  postingsConfig: {},
  modelId: 'test',
  useStubEmbeddings: true,
  log: () => {},
  embeddingsEnabled: true
};

const result = await buildPostings(baseInput);
const docVec = result.quantizedDocVectors[0];
assert.ok(docVec instanceof Uint8Array, 'expected byte vector for doc embeddings');
assert.ok(docVec.every((v) => v === 128), 'expected zero-vector for empty doc marker');

const missingMarkerInput = {
  ...baseInput,
  chunks: [
    {
      tokenCount: 0,
      embedding_u8: new Uint8Array([1, 2, 3]),
      embed_code_u8: new Uint8Array([1, 2, 3])
    }
  ]
};

const missingResult = await buildPostings(missingMarkerInput);
const missingDocVec = missingResult.quantizedDocVectors[0];
assert.ok(missingDocVec instanceof Uint8Array, 'expected byte vector for missing doc marker');
assert.deepEqual(
  Array.from(missingDocVec),
  Array.from(missingResult.quantizedVectors[0]),
  'expected missing doc marker to fall back to merged embedding'
);

console.log('postings doc-only missing doc marker test passed');
