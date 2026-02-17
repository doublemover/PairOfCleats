#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState } from '../../../src/index/build/state.js';
import { quantizeVecUint8 } from '../../../src/index/embedding.js';
import { createTokenRetentionState, buildIndexPostings } from '../../../src/index/build/indexer/steps/postings.js';

const sharedMerged = new Float32Array([0.1, -0.2, 0.3, -0.4]);
const sharedDoc = new Float32Array([0.4, -0.1, 0.2, -0.3]);

const runtime = {
  userConfig: { indexing: {} },
  postingsConfig: {},
  embeddingEnabled: true,
  profile: { id: 'default' },
  workerPool: null,
  quantizePool: null,
  buildRoot: null,
  modelId: 'stub',
  useStubEmbeddings: true,
  stage: 'stage1'
};

const state = createIndexState();
const { appendChunkWithRetention } = createTokenRetentionState({
  runtime,
  totalFiles: 2,
  log: () => {}
});

const makeChunk = (file) => ({
  file,
  tokens: ['alpha', 'beta'],
  tokenIds: ['1', '2'],
  seq: ['alpha', 'beta'],
  docmeta: {},
  stats: {},
  minhashSig: [1, 2],
  embedding: sharedMerged,
  embed_code: sharedMerged,
  embed_doc: sharedDoc
});

appendChunkWithRetention(state, makeChunk('src/a.js'), state);
appendChunkWithRetention(state, makeChunk('src/b.js'), state);

assert.equal(state.chunks.length, 2, 'expected two chunks appended');
assert.ok(state.chunks[0].embedding_u8 instanceof Uint8Array, 'expected quantized merged vector');
assert.ok(state.chunks[0].embed_doc_u8 instanceof Uint8Array, 'expected quantized doc vector');
assert.ok(state.chunks[0].embed_code_u8 instanceof Uint8Array, 'expected quantized code vector');

assert.equal(
  state.chunks[0].embedding_u8,
  state.chunks[0].embed_code_u8,
  'expected code quantization to reuse merged buffer when source vectors are identical'
);
assert.equal(
  state.chunks[0].embedding_u8,
  state.chunks[1].embedding_u8,
  'expected reused quantized buffers across chunks sharing identical source vectors'
);
assert.equal(
  state.chunks[0].embed_doc_u8,
  state.chunks[1].embed_doc_u8,
  'expected reused quantized doc buffers across chunks sharing identical source vectors'
);

const expectedMerged = Array.from(quantizeVecUint8(sharedMerged));
const expectedDoc = Array.from(quantizeVecUint8(sharedDoc));
assert.deepEqual(Array.from(state.chunks[0].embedding_u8), expectedMerged, 'merged quantization drifted');
assert.deepEqual(Array.from(state.chunks[0].embed_code_u8), expectedMerged, 'code quantization drifted');
assert.deepEqual(Array.from(state.chunks[0].embed_doc_u8), expectedDoc, 'doc quantization drifted');

const postings = await buildIndexPostings({ runtime, state });
assert.equal(postings.quantizedVectors.length, 2, 'expected dense vectors for both chunks');
assert.deepEqual(Array.from(postings.quantizedVectors[0]), expectedMerged, 'downstream merged vector drifted');
assert.deepEqual(Array.from(postings.quantizedVectors[1]), expectedMerged, 'downstream merged vector drifted');
assert.deepEqual(Array.from(postings.quantizedCodeVectors[0]), expectedMerged, 'downstream code vector drifted');
assert.deepEqual(Array.from(postings.quantizedDocVectors[0]), expectedDoc, 'downstream doc vector drifted');

console.log('postings quantization buffer reuse no-drift test passed');
