import assert from 'node:assert/strict';
import { createInlineEmbeddingBatcher, closeInlineEmbeddingBatcher } from '../../../src/shared/embedding-inline-batcher.js';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const started = deferred(), providerRelease = deferred(), calls = [];
const provider = async texts => {
  calls.push(texts.slice()); started.resolve(); await providerRelease.promise;
  return texts.map(text => Float32Array.of(text.length, 1));
};
const batcher = createInlineEmbeddingBatcher(provider);
const canceled = new AbortController();
let batchSignal;
const first = batcher.request(['shared', 'second', 'shared'], { signal: canceled.signal, batchSize: 8,
  run: (fn, options) => { batchSignal = options.signal; return fn(); } });
const firstFailure = assert.rejects(first, error => error.name === 'AbortError');
const second = batcher.request(['shared', 'third'], { signal: new AbortController().signal, batchSize: 8 });
await started.promise; canceled.abort(); await firstFailure;
assert.equal(batchSignal.aborted, false, 'a canceled requester cannot cancel shared active provider work');
providerRelease.resolve();
const surviving = await second;
assert.deepEqual(surviving.map(row => Array.from(row)), [[6, 1], [5, 1]]);
assert.deepEqual(calls, [['shared', 'second', 'third']], 'exact text dedup is restored through deterministic inverse mapping');
await batcher.close(); assert.equal(batcher.stats().pendingBytes, 0); assert.equal(batcher.stats().pendingItems, 0);

const queuedCalls = [], queuedProvider = async texts => { queuedCalls.push(texts); return texts.map(() => Float32Array.of(0.5, 0.5)); };
const queued = createInlineEmbeddingBatcher(queuedProvider), abortQueued = new AbortController();
const dropped = queued.request(['canceled-before-dispatch'], { signal: abortQueued.signal });
const droppedFailure = assert.rejects(dropped, error => error.name === 'AbortError');
abortQueued.abort(); await droppedFailure;
await queued.request(['live']); await queued.close();
assert.deepEqual(queuedCalls, [['live']]);

const dispatchQueued = deferred(), dispatchRelease = deferred(), replaceAbort = new AbortController();
const replacementCalls = [];
const replacement = createInlineEmbeddingBatcher(async texts => { replacementCalls.push(texts); return texts.map(() => Float32Array.of(1)); });
const abandoned = replacement.request(['same-after-abort'], { signal: replaceAbort.signal, run: async (fn, options) => {
  dispatchQueued.resolve(); await dispatchRelease.promise;
  if (options.signal.aborted) throw Object.assign(new Error('scheduler admission canceled'), { name: 'AbortError' });
  return fn();
} });
const abandonedFailure = assert.rejects(abandoned, error => error.name === 'AbortError');
await dispatchQueued.promise; replaceAbort.abort();
const lateOwner = replacement.request(['same-after-abort']);
dispatchRelease.resolve(); await abandonedFailure;
assert.equal((await lateOwner)[0][0], 1, 'a new owner does not inherit an already-aborted dispatch lease');
assert.deepEqual(replacementCalls, [['same-after-abort']]); await replacement.close();

let estimatesReleased = 0;
const tokenCalls = [], tokenProvider = async texts => { tokenCalls.push(texts.slice()); return texts.map(text => Float32Array.of(text.length)); };
tokenProvider.estimateTokensBatch = async texts => {
  const estimates = texts.map(text => text.length);
  Object.defineProperty(estimates, 'release', { value: () => { estimatesReleased++; } });
  return estimates;
};
const tokenBatcher = createInlineEmbeddingBatcher(tokenProvider);
const tokenRows = await tokenBatcher.request(['a', 'bb', 'ccc', 'dddd', 'a'], { batchSize: 4, tokenBudget: 5 });
assert.deepEqual(tokenRows.map(row => row[0]), [1, 2, 3, 4, 1]);
assert.ok(tokenCalls.every(texts => texts.length <= 4 && texts.reduce((sum, text) => sum + text.length, 0) <= 5));
assert.equal(estimatesReleased, 1); await tokenBatcher.close();

const failure = new Error('injected provider failure'); let failureCalls = 0;
const failing = createInlineEmbeddingBatcher(async () => { failureCalls++; throw failure; });
const failed = await Promise.allSettled([failing.request(['duplicate']), failing.request(['duplicate'])]);
assert.ok(failed.every(result => result.status === 'rejected' && result.reason === failure));
assert.equal(failureCalls, 1, 'failed shared inference is not amplified into singleton retries'); await failing.close();
const bounded = createInlineEmbeddingBatcher(queuedProvider, { maxQueuedItems: 2, maxQueuedBytes: 512 });
await assert.rejects(bounded.request(['one', 'two', 'three']), RangeError);
assert.equal(bounded.stats().pendingBytes, 0); await bounded.close();

const activeStarted = deferred(), activeRelease = deferred();
const active = createInlineEmbeddingBatcher(async texts => { activeStarted.resolve(); await activeRelease.promise; return texts.map(() => Float32Array.of(1)); });
const activeRequest = active.request(['active']);
const activeFailure = assert.rejects(activeRequest, error => error.code === 'ERR_EMBEDDING_RUNTIME_CLOSED');
await activeStarted.promise;
let closed = false;
const closing = active.close().then(() => { closed = true; });
await activeFailure; await new Promise(resolve => setImmediate(resolve));
assert.equal(closed, false, 'teardown awaits native work after its requester stops waiting');
activeRelease.resolve(); await closing;
assert.equal(active.stats().pendingBytes, 0);

const inlineCalls = [], borrowed = [];
const inline = async texts => {
  inlineCalls.push(texts.slice());
  return texts.map(text => { const row = text === 'doc' ? Float32Array.of(0, 1) : Float32Array.of(1, 0); borrowed.push(row); return row; });
};
const chunks = [{}, {}], other = [{}], warnings = [], originalWarn = console.warn;
try {
  console.warn = warning => warnings.push(String(warning));
  await Promise.all([
    attachEmbeddings({ chunks, codeTexts: ['same', 'unique'], docTexts: ['doc', ''], embeddingEnabled: true,
      embeddingNormalize: true, getChunkEmbeddings: inline, embeddingBatchSize: 8, abortSignal: new AbortController().signal, runEmbedding: fn => fn() }),
    attachEmbeddings({ chunks: other, codeTexts: ['same'], docTexts: [''], embeddingEnabled: true,
      embeddingNormalize: true, getChunkEmbeddings: inline, embeddingBatchSize: 8, abortSignal: new AbortController().signal, runEmbedding: fn => fn() })
  ]);
} finally { console.warn = originalWarn; await closeInlineEmbeddingBatcher(inline); }
assert.equal(inlineCalls.length, 1, 'signal-bearing inline files share the same admitted inference window');
assert.deepEqual(new Set(inlineCalls[0]), new Set(['same', 'unique', 'doc']));
assert.deepEqual(Array.from(chunks[0].embed_code_u8), [255, 128]);
assert.deepEqual(Array.from(chunks[0].embed_doc_u8), [128, 255]);
assert.deepEqual(Array.from(chunks[0].embedding_u8), [218, 218]);
assert.equal(chunks[1].embed_doc_u8.length, 0);
assert.deepEqual(chunks[1].embedding_u8, other[0].embedding_u8);
assert.ok(borrowed.every(row => row[0] === 1 && row[1] === 0 || row[0] === 0 && row[1] === 1));
assert.ok(warnings.every(warning => warning.startsWith('[embeddings] Quantization clamped')));
console.log('Inline batching shares token planning and text work while preserving per-request cancellation, channel mapping and awaited teardown.');
