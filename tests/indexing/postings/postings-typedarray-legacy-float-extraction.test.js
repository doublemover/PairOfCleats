#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildPostings } from '../../../src/index/build/postings.js';

const result = await buildPostings({
  chunks: [
    {
      tokenCount: 0,
      embedding: new Float32Array([0.1, 0.2]),
      embed_code: new Float32Array([0.2, 0.3]),
      embed_doc: new Float32Array([0.3, 0.4])
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
});

assert.ok(Array.isArray(result.quantizedVectors[0]), 'expected quantized merged vector array');
assert.equal(result.quantizedVectors[0].length, 2, 'expected merged vector dims');
assert.ok(Array.isArray(result.quantizedDocVectors[0]), 'expected quantized doc vector array');
assert.ok(Array.isArray(result.quantizedCodeVectors[0]), 'expected quantized code vector array');

console.log('postings typedarray legacy float extraction test passed');
