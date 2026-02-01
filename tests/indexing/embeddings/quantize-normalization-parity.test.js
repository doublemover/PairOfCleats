#!/usr/bin/env node
import assert from 'node:assert/strict';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';
import { normalizeVec, quantizeVecUint8 } from '../../../src/index/embedding.js';
import { mergeEmbeddingVectors } from '../../../src/shared/embedding-utils.js';

const codeVec = new Float32Array([3, 4]);
const docVec = new Float32Array([0, 5]);

const chunks = [{}];

await attachEmbeddings({
  chunks,
  codeTexts: ['code'],
  docTexts: ['doc'],
  embeddingEnabled: true,
  getChunkEmbeddings: async (texts) => texts.map((text) => (text.includes('doc') ? docVec : codeVec)),
  getChunkEmbedding: async (text) => (text.includes('doc') ? docVec : codeVec),
  runEmbedding: (fn) => fn(),
  embeddingBatchSize: 0
});

const expectedCode = quantizeVecUint8(normalizeVec(codeVec));
const expectedDoc = quantizeVecUint8(normalizeVec(docVec));
const merged = mergeEmbeddingVectors({ codeVector: codeVec, docVector: docVec });
const expectedMerged = quantizeVecUint8(normalizeVec(merged));

assert.deepEqual(Array.from(chunks[0].embed_code_u8 || []), Array.from(expectedCode));
assert.deepEqual(Array.from(chunks[0].embed_doc_u8 || []), Array.from(expectedDoc));
assert.deepEqual(Array.from(chunks[0].embedding_u8 || []), Array.from(expectedMerged));

console.log('embedding quantize normalization parity ok');
