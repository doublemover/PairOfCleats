import assert from 'node:assert/strict';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { runBatched } from '../../../tools/build/embeddings/embed.js';
import { createPreparedTokenRows, createTokenizationIdentity, prepareTokenRowsWithCache, tokenizeBatchWithCache } from '../../../src/shared/onnx-embeddings/tokenization.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('embeddings/pipeline/preparation-window-admission/')[1];
assert.ok(['before-estimation-and-through-release', 'ordered-windows-beyond-token-lru', 'oversized-text-before-provider-work', 'single-global-reservation'].includes(mode));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = texts => ({ items: texts.map((_, index) => ({ index })), codeTexts: texts, docTexts: [], codeMapping: texts.map((_, index) => index), docMapping: [] });
const options = { mode: 'code', embeddingBatchSize: 64, runBatched, scheduleCompute: action => action(),
  assertVectorArrays: (vectors, count) => assert.equal(vectors.length, count), processFileEmbeddings: async () => {} };

if (mode === 'before-estimation-and-through-release') {
  const releaseStarted = deferred(), finishRelease = deferred(); let estimates = 0, releases = 0;
  let processor;
  processor = createFileEmbeddingsProcessor({ ...options, globalMicroBatchingMaxPending: 4, globalMicroBatchingMaxPendingBytes: 20,
    estimateEmbeddingTokensBatch: texts => {
      estimates++; assert.equal(processor.batchingStats().pending, 1); assert.equal(processor.batchingStats().pendingBytes, 20);
      return Object.defineProperty(texts.map(() => 1), 'release', { value: async () => {
        releases++; if (releases === 1) { releaseStarted.resolve(); await finishRelease.promise; }
        assert.equal(processor.batchingStats().pendingBytes, 20);
      } });
    }, getChunkEmbeddings: async texts => texts.map(() => [1, 2]) });
  const first = processor(entry(['aa'])); await releaseStarted.promise;
  const second = processor(entry(['bb'])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(estimates, 1, 'a waiting producer cannot tokenize before its source byte reservation');
  finishRelease.resolve(); await Promise.all([first, second]); await processor.drain();
  assert.equal(estimates, 2); assert.equal(releases, 2); assert.equal(processor.batchingStats().pendingBytes, 0);
} else if (mode === 'ordered-windows-beyond-token-lru') {
  let tokenized = 0; const windowSizes = [], tokenizer = texts => {
    tokenized += texts.length; return { input_ids: texts.map(text => [Number(text) + 1]), attention_mask: texts.map(() => [1]) };
  };
  const cache = { enabled: true, cache: new Map(), maxEntries: 8 }, prepared = createPreparedTokenRows();
  const identity = createTokenizationIdentity({ tokenizer });
  const processor = createFileEmbeddingsProcessor({ ...options,
    estimateEmbeddingTokensBatch: texts => {
      windowSizes.push(texts.length);
      const rows = prepareTokenRowsWithCache({ tokenizer, texts, tokenizationCache: cache });
      return Object.defineProperty(rows.map(row => row.input_ids.length), 'release', { value: prepared.retain(texts, rows, identity) });
    }, getChunkEmbeddings: async texts => {
      const encoded = tokenizeBatchWithCache({ tokenizer, texts, tokenizationCache: cache, preparedRows: prepared });
      return encoded.input_ids.map(row => [row[0], 1]);
    } });
  const input = entry(Array.from({ length: 600 }, (_, index) => String(index)));
  await processor(input); await processor.drain();
  assert.deepEqual(windowSizes, [256, 256, 88]); assert.equal(tokenized, 600, 'bounded admitted windows retain rows across a much smaller LRU');
  assert.deepEqual(input.codeEmbeds.map(vector => vector[0]), Array.from({ length: 600 }, (_, index) => index + 1));
  assert.equal(prepared.stats().bytes, 0); assert.equal(processor.batchingStats().pendingBytes, 0);
} else if (mode === 'oversized-text-before-provider-work') {
  let estimates = 0, dispatches = 0, published = 0;
  const processor = createFileEmbeddingsProcessor({ ...options, globalMicroBatchingMaxPendingBytes: 20,
    estimateEmbeddingTokensBatch: () => { estimates++; return [1]; }, getChunkEmbeddings: async () => { dispatches++; return [[1, 2]]; },
    processFileEmbeddings: async () => { published++; } });
  await assert.rejects(processor(entry(['aa', 'too large'])), RangeError); await processor.drain();
  assert.equal(estimates, 0); assert.equal(dispatches, 0); assert.equal(published, 0);
} else {
  let prepared = 0, released = 0;
  const processor = createFileEmbeddingsProcessor({ ...options, globalMicroBatching: true,
    globalMicroBatchingMaxPending: 1, globalMicroBatchingMaxWaitMs: 1, globalMicroBatchingMaxPendingBytes: 1024,
    estimateEmbeddingTokensBatch: texts => {
      prepared++; return Object.defineProperty(texts.map(() => 1), 'release', { value: () => { released++; } });
    }, getChunkEmbeddings: async texts => texts.map(text => [text.length, 1]) });
  const first = entry(['one']), second = entry(['two']);
  await Promise.all([processor(first), processor(second)]); await processor.drain();
  assert.equal(prepared, 2); assert.equal(released, 2);
  assert.deepEqual(first.codeEmbeds, [[3, 1]]); assert.deepEqual(second.codeEmbeds, [[3, 1]]);
  assert.equal(processor.batchingStats().peakPending, 1, 'global collection reuses the preparation reservation rather than nesting another one');
  assert.equal(processor.batchingStats().pendingBytes, 0);
}
console.log('Preparation begins inside bounded admission and retains that reservation through inference and cleanup.');
