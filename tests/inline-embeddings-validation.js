#!/usr/bin/env node
import assert from 'node:assert/strict';

import { attachEmbeddings } from '../src/index/build/file-processor/embeddings.js';

{
  const chunks = [{}, {}];
  await assert.rejects(
    () => attachEmbeddings({
      chunks,
      codeTexts: ['a', 'b'],
      docTexts: ['', 'doc'],
      embeddingEnabled: true,
      embeddingMode: 'both',
      embeddingBatchSize: 16,
      runEmbedding: async (fn) => await fn(),
      getChunkEmbedding: async () => [1, 2],
      getChunkEmbeddings: async () => [[1, 2], [1, 2, 3]]
    }),
    /dims mismatch/i,
    'expected inline embedding attachment to fail fast on dims mismatch'
  );
}

{
  const chunks = [{}, {}];
  const res = await attachEmbeddings({
    chunks,
    codeTexts: ['a', 'b'],
    docTexts: ['', 'doc'],
    embeddingEnabled: true,
    embeddingMode: 'both',
    embeddingBatchSize: 16,
    runEmbedding: async (fn) => await fn(),
    getChunkEmbedding: async () => [9, 9, 9],
    getChunkEmbeddings: async (texts) => texts.map((_, i) => new Float32Array([i, i + 1, i + 2]))
  });

  assert.ok(res && Number.isFinite(res.embeddingMs), 'expected timing result');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].embed_code.length, 3);
  assert.equal(chunks[0].embed_doc.length, 3, 'expected zero doc vector when doc text is missing');
  assert.equal(chunks[0].embedding.length, 3);
  assert.equal(chunks[1].embed_doc.length, 3, 'expected doc embedding vector');
}

console.log('inline embeddings validation test passed');
