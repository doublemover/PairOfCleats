import assert from 'node:assert/strict';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';

// Inert adapters exercise actual timeout/cancellation owners without a runtime,
// tokenizer, model, network access, or native resource.
const hits = [{ file: 'a.js', start: 0, end: 2, score: 4, scoreType: 'bm25' }];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const ownedFailure = ({ observer = true } = {}) => {
  let closed = false;
  const nativeOwner = Object.freeze({ close: async () => { closed = true; } });
  const error = new Error('frozen native cleanup failure');
  Object.defineProperties(error, {
    code: { value: 'CONTROLLED_NATIVE_PENDING' },
    cacheOwnershipPending: { value: true },
    nativeOwner: { value: nativeOwner }
  });
  if (observer) Object.defineProperty(error, 'cacheOwnershipReleased', { value: () => closed });
  return { error: Object.freeze(error), nativeOwner };
};

for (const fallback of [false, true]) {
  const original = ownedFailure();
  await assert.rejects(rerankEvidence({ adapter: { id: `frozen-${fallback}`, rerank: async () => { throw original.error; } },
    hits, fallback }), error => error === original.error,
  'frozen original pending failures cannot become ordinary fallback output');
  assert.equal(Object.isFrozen(original.error), true);
}

const ordinary = Object.freeze(Object.defineProperty(new Error('ordinary frozen error'), 'code', { value: 'CONTROLLED_ORDINARY' }));
await assert.rejects(rerankEvidence({ adapter: { id: 'ordinary-frozen', rerank: async () => { throw ordinary; } }, hits }),
  error => error === ordinary);
const ordinaryFallback = await rerankEvidence({ adapter: { id: 'ordinary-frozen', rerank: async () => { throw ordinary; } },
  hits, fallback: true });
assert.equal(ordinaryFallback.rerankDiagnostic.reason, 'CONTROLLED_ORDINARY');
assert.equal(ordinaryFallback.rerankDiagnostic.pending, false);
assert.equal(ordinaryFallback[0].score, 4);

for (const observer of [false, true]) {
  const late = deferred(), original = ownedFailure({ observer });
  const adapter = { id: `late-frozen-${observer}`, rerank: () => late.promise };
  const output = await rerankEvidence({ adapter, hits, maxMs: 5, fallback: true });
  assert.equal(output.rerankDiagnostic.pending, true);
  assert.equal(output.rerankerOwner, adapter);
  late.reject(original.error);
  const receipt = await output.rerankerSettlement;
  assert.equal(receipt.settled, true); assert.equal(receipt.pending, true);
  assert.equal(receipt.primaryError, original.error);
  assert.equal(receipt.primaryError.nativeOwner, original.nativeOwner);
  assert.equal(receipt.error.code, 'CONTROLLED_NATIVE_PENDING');
  assert.equal(Object.getOwnPropertyDescriptor(receipt, 'primaryError').enumerable, false);
  await original.nativeOwner.close();
  assert.equal(receipt.pending, !observer, 'work rejection alone never clears unobserved native ownership');
  assert.equal(receipt.cacheOwnershipReleased(), observer);
  assert.equal(output[0].score, 4, 'late rejection cannot alter an isolated published fallback');
}

const cancellationWork = deferred(), started = deferred(), controller = new AbortController();
const cancellationAdapter = { id: 'cancel-late-frozen', rerank: () => { started.resolve(); return cancellationWork.promise; } };
const operation = rerankEvidence({ adapter: cancellationAdapter, hits, signal: controller.signal, maxMs: 1000, fallback: true });
await started.promise; controller.abort();
let cancellationError;
await assert.rejects(operation, error => {
  cancellationError = error;
  assert.equal(error.name, 'AbortError'); assert.equal(error.cacheOwnershipPending, true);
  assert.equal(error.rerankerOwner, cancellationAdapter); assert.equal(error.cacheOwnershipReleased(), false);
  return true;
});
const cancelledNative = ownedFailure(); cancellationWork.reject(cancelledNative.error);
const cancelledReceipt = await cancellationError.rerankerSettlement;
assert.equal(cancelledReceipt.primaryError, cancelledNative.error);
assert.equal(cancelledReceipt.pending, true); assert.equal(cancellationError.cacheOwnershipPending, true);
await cancelledNative.nativeOwner.close();
assert.equal(cancellationError.cacheOwnershipReleased(), true); assert.equal(cancellationError.cacheOwnershipPending, false);
assert.equal(cancelledReceipt.pending, false);

const successWork = deferred();
const successFallback = await rerankEvidence({ adapter: { id: 'late-complete', rerank: () => successWork.promise },
  hits, maxMs: 5, fallback: true });
successWork.resolve([{ index: 0, score: 1 }]);
const successReceipt = await successFallback.rerankerSettlement;
assert.deepEqual(successReceipt, { settled: true, pending: false });
assert.equal(successReceipt.cacheOwnershipReleased(), true);
assert.equal(hits[0].score, 4);
console.log('Frozen and late reranker pending ownership controls authored; all execution remains deferred.');
