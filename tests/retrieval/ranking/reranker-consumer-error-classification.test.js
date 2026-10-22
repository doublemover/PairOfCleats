import assert from 'node:assert/strict';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';

// Inert actual consumer controls; no model, native, child or external IO.
const hits = [{ file: 'original.js', start: 0, end: 2, score: 4, scoreType: 'bm25' }];
const run = (error, fallback = true) => rerankEvidence({ adapter: {
  id: 'inert-diagnostic-owner', rerank: async () => { throw error; }
}, hits, fallback });

for (const fallback of [false, true]) {
  let settled = false, observerReads = 0, replaced = false, messageReads = 0;
  const inspection = Object.freeze(Object.defineProperty(new Error('independent original diagnostic owner'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, inspection); return settled; }
  }));
  const primary = Object.freeze(Object.defineProperties({}, {
    message: { get() { messageReads++; throw inspection; } },
    cacheOwnershipReleased: { get() { observerReads++; return replaced ? () => true : () => true; } }
  }));
  let failure;
  await assert.rejects(run(primary, fallback), error => {
    failure = error; assert.equal(error.cause, primary); assert.equal(error.cacheOwnershipPending, true);
    assert.deepEqual(error.rerankerInspectionErrors, [inspection]); return true;
  });
  assert.equal(messageReads, 1); assert.equal(observerReads, 1);
  replaced = true; assert.equal(failure.cacheOwnershipReleased(), false);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(hits[0].score, 4);
}

let markerReads = 0;
const markerFailure = Object.freeze(Object.defineProperty(new Error('ownership marker getter is unknown'), 'cacheOwnershipPending', {
  get() { markerReads++; throw undefined; }
}));
await assert.rejects(run(markerFailure), error => error === markerFailure);
assert.equal(markerReads, 1, 'consumer never rereads an original throwing ownership getter');

let nativeSettled = false, originalReads = 0;
const observerOnly = Object.freeze(Object.defineProperties(new Error('observer-only pending native work'), {
  cacheOwnershipReleased: { value() { assert.equal(this, observerOnly); originalReads++; return nativeSettled; } }
}));
await assert.rejects(run(observerOnly), error => error === observerOnly);
nativeSettled = true;
const completed = await run(observerOnly);
assert.equal(completed.rerankDiagnostic.status, 'fallback'); assert.equal(completed.rerankDiagnostic.pending, false);
assert.equal(completed[0].score, 4); assert(originalReads > 0);

let cancellationInspectionSettled = false, cancelledReads = 0;
const cancellationInspection = Object.freeze(Object.defineProperty(new Error('cancel flag diagnostic child'), 'cacheOwnershipReleased', {
  value() { assert.equal(this, cancellationInspection); return cancellationInspectionSettled; }
}));
const cancellationPrimary = Object.freeze(Object.defineProperties(new Error('original failure before cancel flag inspection'), {
  cancelled: { get() { cancelledReads++; throw cancellationInspection; } }
}));
let cancellationFailure;
await assert.rejects(run(cancellationPrimary), error => {
  cancellationFailure = error; assert.equal(error.cause, cancellationPrimary);
  assert.deepEqual(error.rerankerDiagnosticErrors, [cancellationInspection]);
  assert.equal(error.cacheOwnershipPending, true); return true;
});
assert.equal(cancelledReads, 1); cancellationInspectionSettled = true;
assert.equal(cancellationFailure.cacheOwnershipReleased(), true);
const reconciled = await run(cancellationPrimary);
assert.equal(cancelledReads, 1); assert.equal(reconciled.rerankDiagnostic.status, 'fallback');

for (const value of [undefined, null, false, 0, '']) {
  const primary = Object.freeze(Object.defineProperties({}, {
    message: { get() { throw value; } }, code: { get() { throw value; } }, name: { get() { throw value; } }
  }));
  await assert.rejects(run(primary, false), error => {
    assert.equal(error.cause, primary); assert.deepEqual(error.rerankerInspectionErrors, [value, value, value]); return true;
  });
  const fallback = await run(primary);
  assert.equal(fallback.rerankDiagnostic.reason, 'Reranker operation failed');
  assert.equal(fallback.rerankDiagnostic.pending, false); assert.equal(fallback[0].score, 4);
  const flagged = Object.freeze(Object.defineProperty(new Error('falsey cancelled getter failure'), 'cancelled', { get() { throw value; } }));
  await assert.rejects(run(flagged, false), error => {
    assert.equal(error.cause, flagged); assert.deepEqual(error.rerankerDiagnosticErrors, [value]); return true;
  });
}

let abortCancelledReads = 0;
const aborted = Object.freeze(Object.defineProperties({}, {
  name: { value: 'AbortError' }, code: { value: 'ABORT_ERR' }, message: { value: 'original abort' },
  cancelled: { get() { abortCancelledReads++; throw new Error('abort does not inspect an unrelated flag'); } }
}));
await assert.rejects(run(aborted), error => error === aborted);
assert.equal(abortCancelledReads, 0);
const flagged = Object.freeze({ cancelled: true, message: 'adapter explicit cancellation' });
await assert.rejects(run(flagged), error => error === flagged);
console.log('Reranker consumer pending/getter/falsey/cancellation classification controls authored; execution deferred.');
