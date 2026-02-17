#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runBatched = async ({ texts, embed }) => embed(texts);
const assertVectorArrays = (vectors, count) => {
  assert.equal(Array.isArray(vectors), true);
  assert.equal(vectors.length, count);
};

const buildEntry = () => ({
  items: [{ index: 0 }, { index: 1 }],
  codeTexts: ['code:0', 'code:1'],
  docTexts: ['doc:0', 'doc:1'],
  codeMapping: [0, 1],
  docMapping: [0, 1]
});

let processCalls = 0;
const processFileEmbeddings = async () => {
  processCalls += 1;
};

let releaseCode = null;
const codeGate = new Promise((resolve) => {
  releaseCode = resolve;
});
const events = [];
const getChunkEmbeddingsParallel = async (texts) => {
  const kind = String(texts[0] || '').startsWith('doc:') ? 'doc' : 'code';
  events.push(`${kind}:start`);
  if (kind === 'code') {
    await codeGate;
  }
  await delay(10);
  events.push(`${kind}:end`);
  return texts.map(() => (kind === 'doc' ? [2] : [1]));
};
getChunkEmbeddingsParallel.supportsParallelDispatch = true;

const parallelProcessor = createFileEmbeddingsProcessor({
  embeddingBatchSize: 64,
  getChunkEmbeddings: getChunkEmbeddingsParallel,
  runBatched,
  assertVectorArrays,
  scheduleCompute: (fn) => fn(),
  processFileEmbeddings,
  mode: 'code',
  parallelDispatch: true
});

const parallelEntry = buildEntry();
const pendingParallel = parallelProcessor(parallelEntry);
await delay(20);
assert.ok(events.includes('code:start'), 'expected code batch start');
assert.ok(events.includes('doc:start'), 'expected doc batch start');
assert.equal(
  events.includes('code:end'),
  false,
  'expected code batch to remain in-flight while doc batch dispatch begins'
);
releaseCode?.();
await pendingParallel;
assert.deepEqual(parallelEntry.codeEmbeds, [[1], [1]], 'expected deterministic code vectors');
assert.deepEqual(parallelEntry.docVectorsRaw, [[2], [2]], 'expected deterministic doc vectors');

const serialEvents = [];
const getChunkEmbeddingsSerial = async (texts) => {
  const kind = String(texts[0] || '').startsWith('doc:') ? 'doc' : 'code';
  serialEvents.push(`${kind}:start`);
  await delay(5);
  serialEvents.push(`${kind}:end`);
  return texts.map(() => (kind === 'doc' ? [2] : [1]));
};
getChunkEmbeddingsSerial.supportsParallelDispatch = true;

const serialProcessor = createFileEmbeddingsProcessor({
  embeddingBatchSize: 64,
  getChunkEmbeddings: getChunkEmbeddingsSerial,
  runBatched,
  assertVectorArrays,
  scheduleCompute: (fn) => fn(),
  processFileEmbeddings,
  mode: 'code',
  parallelDispatch: false
});

const serialEntry = buildEntry();
await serialProcessor(serialEntry);
assert.deepEqual(
  serialEvents.slice(0, 4),
  ['code:start', 'code:end', 'doc:start', 'doc:end'],
  'expected serial mode to preserve deterministic code-then-doc dispatch'
);
assert.equal(processCalls, 2, 'expected file processor call for both runs');

console.log('embeddings code/doc parallel dispatch test passed');
