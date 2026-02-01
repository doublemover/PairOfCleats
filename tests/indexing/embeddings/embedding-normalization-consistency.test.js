#!/usr/bin/env node
import assert from 'node:assert/strict';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';
import { buildQuantizedVectors } from '../../../tools/build-embeddings/embed.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';

const vectorNorm = (vec) => {
  if (!vec || !vec.length) return 0;
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
};

const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
};

const codeVec = new Float32Array([0.6, 0.2, 0]);
const zeroVec = new Float32Array(3);

const quantized = buildQuantizedVectors({
  chunkIndex: 0,
  codeVector: codeVec,
  docVector: new Float32Array(0),
  zeroVector: zeroVec,
  addHnswVector: null,
  quantization: {},
  normalize: true
});

const codeFloat = dequantizeUint8ToFloat32(quantized.quantizedCode);
const mergedFloat = dequantizeUint8ToFloat32(quantized.quantizedMerged);
assert.ok(Math.abs(vectorNorm(codeFloat) - 1) < 0.05, 'expected normalized code vector');
assert.ok(Math.abs(vectorNorm(mergedFloat) - 1) < 0.05, 'expected normalized merged vector');
assert.ok(cosineSimilarity(codeFloat, mergedFloat) > 0.99, 'expected merged vector to align with code');

const chunks = [{}];
await attachEmbeddings({
  chunks,
  codeTexts: ['code'],
  docTexts: [''],
  embeddingEnabled: true,
  embeddingNormalize: true,
  getChunkEmbedding: async () => codeVec,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  embeddingBatchSize: 0,
  fileLanguageId: 'js',
  languageOptions: null
});

const mergedU8 = chunks[0].embedding_u8;
const codeU8 = chunks[0].embed_code_u8;
const mergedFloatInline = dequantizeUint8ToFloat32(mergedU8);
assert.ok(Math.abs(vectorNorm(mergedFloatInline) - 1) < 0.05, 'expected normalized stored vector');
assert.deepEqual(Array.from(mergedU8), Array.from(codeU8), 'expected merged == code when docs missing');

console.log('embedding normalization consistency test passed');
