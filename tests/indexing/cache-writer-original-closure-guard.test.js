// Actual cache writer release/composition owners; inert resources, UNVALIDATED.
import assert from 'node:assert/strict';
import { combineCacheWriterErrors, releaseCacheWriterOwnership } from '../../src/index/build/cache-writer-drain.js';

const trackedLease = () => {
  const calls = [];
  return { calls, lease: { assertOwned() { calls.push('assert'); }, invalidate() { calls.push('invalidate'); } },
    release: async () => { calls.push('release'); return 'released'; } };
};
for (const marker of [undefined, false, true]) {
  let closed = false;
  const primary = new Error('original child remains pending independently of its marker');
  Object.assign(primary, { ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
    cacheOwnershipReleased() { assert.equal(this, primary); return closed; } });
  Object.freeze(primary);
  const owner = trackedLease();
  await assert.rejects(releaseCacheWriterOwnership({ ...owner, operationError: primary }), error => error === primary);
  assert.deepEqual(owner.calls, [], 'pending original observation prevents assertion, invalidation and physical release');
  closed = true;
  assert.equal(await releaseCacheWriterOwnership({ ...owner, operationError: primary }), 'released');
  assert.deepEqual(owner.calls, ['assert', 'invalidate', 'release']);
}

let operationClosed = false, cleanupClosed = false;
const operation = Object.assign(new Error('original operation owner'), { code: 'ORIGINAL_OPERATION',
  cacheOwnershipReleased() { assert.equal(this, operation); return operationClosed; } });
const cleanup = Object.assign(new Error('original cleanup owner'), {
  cacheOwnershipReleased() { assert.equal(this, cleanup); return cleanupClosed; } });
const combined = combineCacheWriterErrors(operation, cleanup);
assert.equal(combined.cause, operation);
assert.deepEqual(combined.errors, [operation, cleanup]);
assert.equal(combined.operationError, operation); assert.equal(combined.cleanupError, cleanup);
assert.equal(combined.code, 'ORIGINAL_OPERATION');
operation.cacheOwnershipReleased = () => true;
cleanup.cacheOwnershipReleased = () => true;
const owner = trackedLease();
await assert.rejects(releaseCacheWriterOwnership({ ...owner, operationError: combined }), error => error === combined);
operationClosed = true;
await assert.rejects(releaseCacheWriterOwnership({ ...owner, operationError: combined }), error => error === combined);
assert.deepEqual(owner.calls, [], 'both original functions remain required after property replacement');
cleanupClosed = true;
assert.equal(await releaseCacheWriterOwnership({ ...owner, operationError: combined }), 'released');
assert.deepEqual(owner.calls, ['assert', 'invalidate', 'release']);

for (const evidence of ['missing', 'throwing', 'marker-getter', 'observer-getter']) {
  const primary = new Error(`unknown original ${evidence} evidence`);
  if (evidence === 'marker-getter') Object.defineProperty(primary, 'cacheOwnershipPending', { get() { throw new Error('unknown pending marker'); } });
  else primary.cacheOwnershipPending = true;
  if (evidence === 'throwing') primary.cacheOwnershipReleased = () => { throw new Error('unknown release observation'); };
  if (evidence === 'observer-getter') Object.defineProperty(primary, 'cacheOwnershipReleased', { get() { throw new Error('unknown original observer'); } });
  Object.freeze(primary);
  const unknown = combineCacheWriterErrors(new Error('ordinary operation failure'), primary), held = trackedLease();
  assert.equal(unknown.cacheOwnershipReleased(), false);
  await assert.rejects(releaseCacheWriterOwnership({ ...held, operationError: unknown }), error => error === unknown);
  assert.deepEqual(held.calls, []);
}

const unreadable = new Error('unreadable frozen diagnostics');
Object.defineProperties(unreadable, { message: { get() { throw new Error('unreadable primary message'); } },
  code: { get() { throw new Error('unreadable primary code'); } } });
Object.freeze(unreadable);
const diagnosticFailure = combineCacheWriterErrors(unreadable, Object.freeze(new Error('cleanup failed')));
assert.equal(diagnosticFailure.cause, unreadable);
assert.deepEqual(diagnosticFailure.errors, [unreadable, diagnosticFailure.cleanupError]);
assert.equal(typeof diagnosticFailure.message, 'string');
const ordinary = trackedLease();
assert.equal(await releaseCacheWriterOwnership({ ...ordinary, operationError: diagnosticFailure }), 'released');
const undrained = trackedLease();
await assert.rejects(releaseCacheWriterOwnership({ ...undrained, drained: false }), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
assert.deepEqual(undrained.calls, []);
console.log('Cache writer original closure guard controls authored; execution deferred.');
