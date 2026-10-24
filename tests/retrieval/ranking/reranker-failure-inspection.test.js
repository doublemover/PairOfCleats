import assert from 'node:assert/strict';
import { captureRerankerFailure } from '../../../src/retrieval/rerankers/failure-inspection.js';
import { preserveRerankerFailure, trackRerankerWork } from '../../../src/retrieval/rerankers/failure-ownership.js';
import { crossEncoderCleanupFailure } from '../../../src/retrieval/rerankers/local-resource-owner.js';

// Authored controls only. No runtime/model/native/storage acquisition.
let inspectionSettled = false, replacement = false, observerReads = 0;
const inspection = new Error('original independent diagnostic inspection owner');
const originalObserver = function () { assert.equal(this, inspection); return inspectionSettled; };
Object.defineProperty(inspection, 'cacheOwnershipReleased', {
  get() { observerReads++; return replacement ? () => true : originalObserver; }
});
Object.freeze(inspection);
let messageReads = 0, codeReads = 0, nameReads = 0, ownerReads = 0;
const lazy = new Error('lazy stack must never be requested');
Object.defineProperties(lazy, {
  message: { get() { messageReads++; throw inspection; } },
  code: { get() { codeReads++; return 'CONTROLLED_ORIGINAL'; } },
  name: { get() { nameReads++; return 'OriginalFailure'; } },
  rerankerOwner: { get() { ownerReads++; throw undefined; } }
});
const wrapped = preserveRerankerFailure(lazy);
assert.equal(wrapped.cause, lazy); assert.equal(wrapped.message, 'Reranker operation failed');
assert.equal(wrapped.code, 'CONTROLLED_ORIGINAL'); assert.equal(wrapped.name, 'OriginalFailure');
assert.deepEqual(wrapped.rerankerInspectionErrors, [inspection, undefined]);
assert.equal(wrapped.cacheOwnershipReleased(), false);
const owner = { pending: true };
const cleanup = Object.freeze(new Error('separate actual cleanup failure'));
const aggregate = crossEncoderCleanupFailure({ owner, hasPrimary: true, primaryError: lazy, cleanupErrors: [cleanup] });
assert.equal(aggregate.cause, lazy); assert.equal(aggregate.primaryError, lazy);
assert.deepEqual(aggregate.errors, [lazy, cleanup, inspection, undefined]);
assert.deepEqual(aggregate.cleanupErrors, [cleanup]);
assert.equal(aggregate.cacheOwnershipReleased(), false);
assert.deepEqual([messageReads, codeReads, nameReads, ownerReads], [1, 1, 1, 1],
  'wrapping and aggregate projection never reread original diagnostic getters or lazy stack');
replacement = true; owner.pending = false;
assert.equal(wrapped.cacheOwnershipReleased(), false); assert.equal(aggregate.cacheOwnershipReleased(), false);
inspectionSettled = true;
assert.equal(wrapped.cacheOwnershipReleased(), true); assert.equal(aggregate.cacheOwnershipReleased(), true);
assert.equal(observerReads, 1, 'all projections share the original independent observer and receiver');

let descriptorSettled = false, stackDescriptors = 0, probeDescriptors = 0;
const descriptorFailure = Object.freeze(Object.defineProperty(new Error('descriptor inspection pending'), 'cacheOwnershipReleased', {
  value() { assert.equal(this, descriptorFailure); return descriptorSettled; }
}));
const target = { message: 'proxy failure', code: 'PROXY_ORIGINAL', probe: 1, stack: 'never inspect' };
const proxy = new Proxy(target, {
  getOwnPropertyDescriptor(object, key) {
    if (key === 'stack') { stackDescriptors++; throw new Error('stack descriptor was requested'); }
    if (key === 'probe') { probeDescriptors++; throw descriptorFailure; }
    return Reflect.getOwnPropertyDescriptor(object, key);
  }
});
const projected = preserveRerankerFailure(proxy, {
  cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { value: () => true }
});
assert.equal(projected.cause, proxy); assert.equal(projected.code, 'PROXY_ORIGINAL');
assert.equal(stackDescriptors, 0); assert.equal(probeDescriptors, 1);
assert.deepEqual(projected.rerankerInspectionErrors, [descriptorFailure]);
assert.equal(projected.cacheOwnershipReleased(), false,
  'a supplied successful observation cannot discard an independent inspection owner');
preserveRerankerFailure(proxy); assert.equal(probeDescriptors, 1); assert.equal(stackDescriptors, 0);
descriptorSettled = true; assert.equal(projected.cacheOwnershipReleased(), true);

for (const value of [undefined, null, false, 0, '']) {
  const falsey = preserveRerankerFailure(value);
  assert.equal(falsey.cause, value); assert.equal(falsey.message, String(value));
  const ownKeysFailure = new Proxy({ message: 'own-key failure' }, { ownKeys() { throw value; } });
  const ownKeysWrapped = preserveRerankerFailure(ownKeysFailure);
  assert.equal(ownKeysWrapped.cause, ownKeysFailure);
  assert.deepEqual(ownKeysWrapped.rerankerInspectionErrors, [value], 'falsey inspection errors retain explicit presence');
}

const deepest = Object.freeze(new Error('nested exact original cause'));
const nested = Object.freeze(new AggregateError([deepest], 'nested aggregate', { cause: deepest }));
const nestedFailure = crossEncoderCleanupFailure({ owner: { pending: false }, hasPrimary: true,
  primaryError: nested, cleanupErrors: [cleanup] });
assert.equal(nestedFailure.cause, nested); assert.deepEqual(nestedFailure.errors, [nested, cleanup]);
assert.equal(nested.cause, deepest); assert.deepEqual(nested.errors, [deepest]);

let lateSettled = false, lateReads = 0;
const lateInspection = Object.freeze(Object.defineProperty(new Error('late work inspection owner'), 'cacheOwnershipReleased', {
  value() { assert.equal(this, lateInspection); return lateSettled; }
}));
const latePrimary = Object.freeze(Object.defineProperty({}, 'message', { get() { lateReads++; throw lateInspection; } }));
const tracked = trackRerankerWork(Promise.reject(latePrimary));
const receipt = await tracked.promise;
assert.equal(receipt.primaryError, latePrimary); assert.deepEqual(receipt.rerankerInspectionErrors, [lateInspection]);
assert.equal(receipt.error.message, 'Reranker operation failed'); assert.equal(receipt.pending, true);
assert.equal(tracked.pending, true); assert.equal(lateReads, 1);
lateSettled = true; assert.equal(tracked.released(), true); assert.equal(receipt.pending, false);

const attached = new Error('absence does not forbid a later original owner');
assert.equal(captureRerankerFailure(attached).hasOwnership, false);
let attachedSettled = false;
Object.defineProperty(attached, 'cacheOwnershipReleased', { value: () => attachedSettled });
const attachedSnapshot = captureRerankerFailure(attached);
assert.equal(attachedSnapshot.hasOwnership, true); assert.equal(attachedSnapshot.released(), false);
attachedSettled = true; assert.equal(attachedSnapshot.released(), true);
console.log('Reranker original diagnostic/descriptor/late-work ownership controls authored; execution deferred.');
