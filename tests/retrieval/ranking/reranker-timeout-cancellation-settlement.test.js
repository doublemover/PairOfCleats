import assert from 'node:assert/strict';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';

const hits = [{ file: 'a.js', start: 0, end: 1, score: 2, scoreType: 'bm25' }];
let complete, observedSignal, borrowed;
const adapter = { id: 'late-inert', rerank: async input => {
  observedSignal = input.signal; borrowed = input.hits;
  return new Promise(resolve => { complete = resolve; });
} };
const fallback = await rerankEvidence({ adapter, hits, maxMs: 5, fallback: true });
assert.equal(fallback.rerankDiagnostic.status, 'fallback'); assert.equal(fallback.rerankDiagnostic.pending, true);
assert.equal(observedSignal.aborted, true); assert.notEqual(borrowed, hits);
assert.equal(Object.isFrozen(borrowed[0]), true);
assert.equal(fallback[0].score, 2); assert.equal(fallback[0].rerankProvenance.status, 'pre-rerank-fallback');
complete([{ index: 0, score: 100 }]); await fallback.rerankerSettlement;
assert.equal(fallback[0].score, 2, 'late scores cannot mutate published fallback ordering');
const sharedHits = structuredClone(hits);
let rejectBorrowed, startedBorrowed;
const borrowedStarted = new Promise(resolve => { startedBorrowed = resolve; });
const pendingFallback = rerankEvidence({ adapter: { id: 'borrowed-fallback', rerank: async () => {
  startedBorrowed(); return new Promise((resolve, reject) => { rejectBorrowed = reject; });
} }, hits: sharedHits, fallback: true });
await borrowedStarted;
sharedHits[0].file = 'foreign.js'; sharedHits[0].score = 999;
rejectBorrowed(new Error('fixture rejection'));
const capturedFallback = await pendingFallback;
assert.equal(capturedFallback[0].file, 'a.js'); assert.equal(capturedFallback[0].score, 2,
  'fallback uses original admitted membership and scores after borrowed inputs change');
const before = new AbortController(); before.abort();
await assert.rejects(rerankEvidence({ adapter, hits, signal: before.signal, fallback: true }), { name: 'AbortError' });
const during = new AbortController(); let started;
const acquired = new Promise(resolve => { started = resolve; });
let finish;
const cancellation = rerankEvidence({ adapter: { id: 'cancel-inert', rerank: async () => {
  started(); return new Promise(resolve => { finish = resolve; });
} }, hits, signal: during.signal, maxMs: 1000, fallback: true });
await acquired; during.abort();
await assert.rejects(cancellation, error => {
  assert.equal(error.name, 'AbortError'); assert.equal(error.cacheOwnershipPending, true);
  assert(error.rerankerSettlement); return true;
});
finish([{ index: 0, score: 1 }]);
const internallyAborted = { id: 'timeout-abort-inert', rerank: ({ signal }) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
}) };
assert.equal((await rerankEvidence({ adapter: internallyAborted, hits, maxMs: 5, fallback: true })).rerankDiagnostic.reason, 'ERR_RERANK_DEADLINE');
const pendingResource = Object.assign(new Error('native owner pending'), { cacheOwnershipPending: true });
await assert.rejects(rerankEvidence({ adapter: { id: 'pending', rerank: async () => { throw pendingResource; } }, hits, fallback: true }), error => error === pendingResource);
console.log('reranker deadline fallback, cancellation and isolated late settlement assertions complete');
