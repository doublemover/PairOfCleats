#!/usr/bin/env node
import assert from 'node:assert/strict';
import { attachEmbeddings } from '../src/index/build/file-processor/embeddings.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const embedFn = async (texts) => {
  await delay(25);
  return texts.map(() => new Float32Array([0.1, 0.2, 0.3]));
};

const makeChunks = (count) => Array.from({ length: count }, () => ({ tokens: ['t'], seq: ['t'] }));
const makeTexts = (count, prefix) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

const runEmbedding = async (fn) => fn();

const chunksA = makeChunks(4);
const chunksB = makeChunks(4);

const timeout = setTimeout(() => {
  console.error('embedding batcher reentrancy test timed out');
  process.exit(1);
}, 5000);

await Promise.all([
  attachEmbeddings({
    chunks: chunksA,
    codeTexts: makeTexts(4, 'codeA'),
    docTexts: makeTexts(4, 'docA'),
    embeddingEnabled: true,
    getChunkEmbedding: async (text) => embedFn([text]).then((out) => out[0]),
    getChunkEmbeddings: embedFn,
    runEmbedding,
    embeddingBatchSize: 2,
    fileLanguageId: 'js',
    languageOptions: {}
  }),
  attachEmbeddings({
    chunks: chunksB,
    codeTexts: makeTexts(4, 'codeB'),
    docTexts: makeTexts(4, 'docB'),
    embeddingEnabled: true,
    getChunkEmbedding: async (text) => embedFn([text]).then((out) => out[0]),
    getChunkEmbeddings: embedFn,
    runEmbedding,
    embeddingBatchSize: 2,
    fileLanguageId: 'js',
    languageOptions: {}
  })
]);

clearTimeout(timeout);

for (const chunk of [...chunksA, ...chunksB]) {
  assert.ok(chunk.embedding_u8 instanceof Uint8Array, 'expected embedding_u8 to be set');
}

console.log('embedding batcher flush reentrancy test passed');
