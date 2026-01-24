#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState } from '../src/index/build/state.js';
import { createTokenRetentionState } from '../src/index/build/indexer/steps/postings.js';

const runtime = {
  userConfig: { indexing: {} },
  embeddingEnabled: true,
  postingsConfig: {}
};
const state = createIndexState();
const { appendChunkWithRetention } = createTokenRetentionState({ runtime, totalFiles: 1, log: () => {} });

const chunk = {
  tokens: ['foo'],
  seq: ['foo'],
  embedding: new Float32Array([0.1, 0.2]),
  embed_code: new Float32Array([0.1, 0.2]),
  embed_doc: new Float32Array([0.2, 0.3])
};

appendChunkWithRetention(state, chunk, state);

assert.ok(state.chunks.length === 1, 'expected chunk to be appended');
const stored = state.chunks[0];
assert.ok(stored.embedding_u8 instanceof Uint8Array, 'expected merged u8 vector');
assert.ok(stored.embed_code_u8 instanceof Uint8Array, 'expected code u8 vector');
assert.ok(stored.embed_doc_u8 instanceof Uint8Array, 'expected doc u8 vector');
assert.ok(stored.embed_code_u8.length > 0, 'expected quantized code vector');

console.log('embedding typedarray quantization test passed');
