import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';

// Actual queue error delivery and aggregation, with inert ownership observers.
// Authored only; execution and qualification are deferred.
const rejected = work => work.then(() => assert.fail('expected queue failure'), error => error);
const run = (worker, options = {}) => runWithQueue(new PQueue({ concurrency: 1 }), [0], worker, options);
const primary = Object.freeze(Object.assign(new Error('frozen worker primary'), { retryable: false }));

for (const value of [undefined, null, false, 0, '']) {
  const direct = await rejected(run(async () => { throw value; }));
  assert.ok(direct instanceof Error);
  assert.equal(direct.cause, value, 'falsey worker rejection remains an exact cause');
  let calls = 0;
  const handler = await rejected(run(async () => { throw primary; }, {
    onError(error) { assert.equal(error, primary); calls++; throw value; }
  }));
  assert.equal(calls, 1);
  assert.ok(handler instanceof AggregateError);
  assert.equal(handler.cause, primary);
  assert.deepEqual(handler.errors, [primary, value]);
  assert.equal(handler.retryable, false);
}

let originalClosed = false, secondaryClosed = false, originalReads = 0, secondaryReads = 0;
const original = new Error('original native ownership');
const exactCapability = Object.freeze({ identity: 'original inert owner' });
Object.defineProperty(original, 'nativeResourceOwner', { value: exactCapability });
Object.assign(original, { code: 'ERR_ORIGINAL_NATIVE_READ', cacheOwnershipPending: false, cacheOwnershipReleased() {
  assert.equal(this, original); originalReads++; return originalClosed;
} });
const secondary = Object.freeze(Object.assign(new Error('callback native ownership'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() {
    assert.equal(this, secondary); secondaryReads++; return secondaryClosed;
  }
}));
const both = await rejected(run(async () => { throw original; }, {
  onError(error) {
    error.cacheOwnershipPending = false;
    error.cacheOwnershipReleased = () => true;
    error.code = 'ERR_REPLACED_DIAGNOSTIC';
    throw secondary;
  }
}));
assert.deepEqual(both.errors, [original, secondary]);
assert.equal(both.cause, original);
assert.equal(both.code, 'ERR_ORIGINAL_NATIVE_READ', 'capture operational metadata before callback mutation');
assert.equal(both.nativeResourceOwner, exactCapability);
assert.equal(Object.keys(both).includes('nativeResourceOwner'), false);
assert.equal(both.cacheOwnershipReleased(), false, 'callback replacement cannot erase the original observer');
assert.equal(both.cacheOwnershipPending, true);
assert.equal(both.retryable, false);
originalClosed = true;
assert.equal(both.cacheOwnershipReleased(), false, 'secondary ownership independently remains pending');
secondaryClosed = true;
assert.equal(both.cacheOwnershipReleased(), true);
assert.equal(both.cacheOwnershipPending, false);
assert.ok(originalReads > 0 && secondaryReads > 0);

let successfulHandlerClosed = false;
const retained = Object.freeze(Object.assign(new Error('successful handler still cannot settle native work'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() {
    assert.equal(this, retained); return successfulHandlerClosed;
  }
}));
const handled = await rejected(run(async () => { throw retained; }, { onError() {} }));
assert.equal(handled.cause, retained);
assert.deepEqual(handled.errors, [retained]);
assert.equal(handled.cacheOwnershipReleased(), false);
successfulHandlerClosed = true;
assert.equal(handled.cacheOwnershipReleased(), true);

for (const unknown of [
  Object.freeze(Object.assign(new Error('missing original observer'), { cacheOwnershipPending: true })),
  Object.freeze(Object.defineProperty(new Error('throwing original observer'), 'cacheOwnershipReleased', {
    get() { throw new Error('observer unavailable'); }
  }))
]) {
  const failure = await rejected(run(async () => { throw unknown; }, { onError() { throw primary; } }));
  assert.equal(failure.cause, unknown);
  assert.equal(failure.cacheOwnershipReleased(), false, 'unknown original settlement cannot become closure');
}

let bestEffortClosed = false;
const pending = Object.freeze(Object.assign(new Error('best effort native owner'), {
  cacheOwnershipPending: false, cacheOwnershipReleased() {
    assert.equal(this, pending); return bestEffortClosed;
  }
}));
const ordinary = Object.freeze(new Error('independent best effort failure'));
const bestEffort = await rejected(runWithQueue(new PQueue({ concurrency: 1 }), [pending, ordinary],
  async error => { throw error; }, { bestEffort: true }));
assert.deepEqual(bestEffort.errors, [pending, ordinary]);
assert.equal(bestEffort.cause, pending);
assert.equal(bestEffort.cacheOwnershipReleased(), false);
bestEffortClosed = true;
assert.equal(bestEffort.cacheOwnershipReleased(), true);

const unchanged = await rejected(run(async () => { throw primary; }, { onError() {} }));
assert.equal(unchanged, primary, 'ordinary successful error reporting preserves failure identity');

let resourceClosed = false, pendingAttempts = 0;
const retryablePending = Object.freeze(Object.assign(new Error('retryable operation with original native work'), {
  retryable: true, cacheOwnershipPending: false,
  cacheOwnershipReleased() { assert.equal(this, retryablePending); return resourceClosed; }
}));
const admission = await rejected(run(async () => { pendingAttempts++; throw retryablePending; }, { retries: 2 }));
assert.equal(pendingAttempts, 1, 'automatic retry cannot replace an unresolved original operation');
assert.equal(admission.cause, retryablePending);
assert.equal(admission.retryable, false);
assert.equal(admission.cacheOwnershipReleased(), false);
resourceClosed = true;
assert.equal(admission.cacheOwnershipReleased(), true);
let settledAttempts = 0;
assert.deepEqual(await run(async () => {
  if (++settledAttempts === 1) throw retryablePending;
  return 'original owner already settled';
}, { retries: 2 }), ['original owner already settled']);
assert.equal(settledAttempts, 2, 'confirmed original closure preserves independently retryable work');

let classificationClosed = false, classificationAttempts = 0;
const policyFailure = Object.freeze(Object.assign(new Error('original retry policy inspection owner'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() {
    assert.equal(this, policyFailure); return classificationClosed;
  }
}));
const unreadable = Object.freeze(Object.defineProperty(new Error('original worker before retry classification'), 'retryable', {
  get() { throw policyFailure; }
}));
const classified = await rejected(run(async () => { classificationAttempts++; throw unreadable; }, { retries: 2 }));
assert.equal(classificationAttempts, 1);
assert.deepEqual(classified.errors, [unreadable, policyFailure]);
assert.equal(classified.cause, unreadable);
assert.equal(classified.retryable, false);
assert.equal(classified.cacheOwnershipReleased(), false);
classificationClosed = true;
assert.equal(classified.cacheOwnershipReleased(), true);
console.log('Queue error and retained ownership controls authored; execution deferred.');
