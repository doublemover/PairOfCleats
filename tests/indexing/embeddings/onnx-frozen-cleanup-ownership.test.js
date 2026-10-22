import assert from 'node:assert/strict';
import { createOnnxResourceOwner, releaseOnnxResources } from '../../../src/shared/onnx-embeddings/resource-lifetime.js';
import { createDeferredEmbeddingAdapter } from '../../../src/shared/embedding-deferred-adapter.js';

// Inert resources exercise the production owner; no model or native import.
const order = [], capability = Object.freeze({ label: 'original nested capability' });
const primary = new Error('original frozen initialization failure');
Object.defineProperties(primary, { code: { value: 'EIO' }, nestedOwner: { value: capability } });
Object.freeze(primary);
const cleanup = Object.freeze(new Error('frozen release failure'));
let refuseSession = true, sessionCalls = 0, tokenizerCalls = 0, capacityCalls = 0;
const session = { release: async () => {
  sessionCalls++; order.push('session'); if (refuseSession) throw cleanup;
} };
const tokenizer = { dispose: async () => { tokenizerCalls++; order.push('tokenizer'); } };
const slot = { release: () => { capacityCalls++; order.push('capacity'); } };
const lease = Object.freeze({ id: 'exact qualification capability' });
const owner = createOnnxResourceOwner({ session, tokenizer, qualificationSlot: slot,
  qualificationLease: lease, primaryError: primary });
const firstRelease = owner.release();
assert.equal(owner.release(), firstRelease, 'concurrent cleanup joins one exact attempt');
const failure = await firstRelease.then(() => assert.fail('cleanup must reject'), error => error);
assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(cleanup));
assert.equal(failure.code, 'EIO'); assert.equal(failure.nestedOwner, capability);
assert.equal(Object.getOwnPropertyDescriptor(failure, 'nestedOwner').enumerable, false);
assert.equal(primary.cacheOwnershipPending, undefined); assert.equal(cleanup.cacheOwnershipPending, undefined);
assert.equal(failure.qualificationLease, lease); assert.equal(failure.onnxSessionOwner.session, session);
assert.equal(failure.onnxResourceOwner, owner); assert.equal(failure.cacheOwnershipReleased(), false);
assert.deepEqual(order, ['session', 'tokenizer']); assert.equal(capacityCalls, 0);
session.release = async () => { assert.fail('never adopt a replacement release method'); };
tokenizer.dispose = async () => { assert.fail('never dispose a successfully released child again'); };
refuseSession = false;
assert.equal(await failure.onnxResourceOwner.release(), true);
assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(failure.cacheOwnershipPending, false);
assert.deepEqual(order, ['session', 'tokenizer', 'session', 'capacity']);
await owner.release(); assert.equal(sessionCalls, 2); assert.equal(tokenizerCalls, 1); assert.equal(capacityCalls, 1);

// An independent pending owner cannot be erased by local release fulfillment.
let nestedReleased = false, capacityAfterNested = 0;
const nestedPrimary = new Error('pending external operation');
Object.defineProperties(nestedPrimary, { cacheOwnershipPending: { value: true },
  cacheOwnershipReleased: { value: () => nestedReleased }, externalOwner: { value: capability } });
Object.freeze(nestedPrimary);
const nested = await releaseOnnxResources({ primaryError: nestedPrimary,
  session: { release: async () => {} }, qualificationSlot: { release: () => { capacityAfterNested++; } } });
assert.equal(nested.cause, nestedPrimary); assert.equal(nested.externalOwner, capability);
assert.equal(nested.cacheOwnershipReleased(), false); assert.equal(capacityAfterNested, 0);
nestedReleased = true;
await nested.onnxResourceOwner.release();
assert.equal(nested.cacheOwnershipReleased(), true); assert.equal(capacityAfterNested, 1);

for (const pendingPrimary of [Object.freeze(Object.assign(new Error('unobserved owner'), { cacheOwnershipPending: true })),
  Object.freeze(Object.assign(new Error('throwing observer'), { cacheOwnershipPending: true,
    cacheOwnershipReleased() { throw new Error('cannot observe'); } }))]) {
  let releasedCapacity = false;
  const pending = await releaseOnnxResources({ primaryError: pendingPrimary,
    session: { release: async () => {} }, qualificationSlot: { release: () => { releasedCapacity = true; } } });
  await assert.rejects(pending.onnxResourceOwner.release());
  assert.equal(pending.cacheOwnershipReleased(), false); assert.equal(releasedCapacity, false);
}

// Capacity release failure is itself retained, instead of replacing the primary.
let refuseCapacity = true, nativeReleases = 0;
const capacityFailure = Object.freeze(new Error('capacity release failed'));
const capacityPending = await releaseOnnxResources({ primaryError: primary,
  session: { release: async () => { nativeReleases++; } }, qualificationSlot: {
    release() { if (refuseCapacity) throw capacityFailure; }
  } });
assert.equal(capacityPending.cause, primary); assert.ok(capacityPending.errors.includes(capacityFailure));
refuseCapacity = false; await capacityPending.onnxResourceOwner.release();
assert.equal(nativeReleases, 1); assert.equal(capacityPending.cacheOwnershipReleased(), true);

// Deferred disposal may ignore an ordinary failed acquisition, never a pending owner.
const deferred = createDeferredEmbeddingAdapter({ provider: 'controlled', methods: ['getEmbedding'], acquire: async () => { throw nested; } });
await assert.rejects(deferred.getEmbedding('source'), error => error === nested);
// Use another still-pending failure: the nested owner above was actually settled.
const unresolved = await releaseOnnxResources({ primaryError: primary, session: { release: async () => { throw cleanup; } } });
const pendingDeferred = createDeferredEmbeddingAdapter({ provider: 'controlled', methods: ['getEmbedding'],
  acquire: async () => { throw unresolved; } });
await assert.rejects(pendingDeferred.getEmbedding('source'), error => error === unresolved);
await assert.rejects(pendingDeferred.dispose(), error => error === unresolved);
await deferred.dispose();
const ordinary = createDeferredEmbeddingAdapter({ provider: 'controlled', methods: ['getEmbedding'], acquire: async () => { throw primary; } });
await assert.rejects(ordinary.getEmbedding('source'), error => error === primary);
await ordinary.dispose();
console.log('ONNX frozen causes, exact cleanup retries, capacity and deferred admission controls passed');
