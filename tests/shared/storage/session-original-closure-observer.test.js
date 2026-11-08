// Actual scoped metadata owners with inert resource observations; UNVALIDATED.
import assert from 'node:assert/strict';
import path from 'node:path';
import { runWithStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('poc-session-original-observer-');
const root = path.join(temporary, 'assets');
const coordinationRoot = path.join(temporary, 'state', 'access');
const input = { roots: [root], coordinationRoot, authorizedRoots: [temporary] };
const retained = new Set();
const release = session => {
  assert.equal(session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), true);
  retained.delete(session);
};
const hold = async (primary, resourceId, settlement) => {
  let failure;
  try { await runWithStorageSession({ ...input, resourceId }, async () => { throw primary; }, { settlement }); }
  catch (error) { failure = error; }
  assert.ok(failure?.storageSession, 'the original resource observer must prevent successful category release');
  retained.add(failure.storageSession);
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  return failure;
};
const confirmed = ({ resourceId }) => ({ resourceId, settled: true, pending: false });
try {
  for (const pendingFlag of [undefined, false]) {
    let closed = false, observations = 0;
    const primary = new Error('original observer owns the resource without a true flag');
    Object.assign(primary, { ...(pendingFlag === undefined ? {} : { cacheOwnershipPending: pendingFlag }),
      cacheOwnershipReleased() { assert.equal(this, primary); observations++; return closed; } });
    Object.freeze(primary);
    const failure = await hold(primary, `observer-with-flag-${pendingFlag}`, confirmed);
    assert.equal(failure.cause, primary);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.ok(observations > 0);
    closed = true;
    assert.equal(failure.cacheOwnershipReleased(), true, 'the original function retains its original receiver');
    release(failure.storageSession);
  }

  let originallyClosed = false;
  const replaced = Object.assign(new Error('settlement replaces an outstanding observer'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => originallyClosed
  });
  const retainedOriginal = await hold(replaced, 'replaced-observer', context => {
    replaced.cacheOwnershipPending = false;
    replaced.cacheOwnershipReleased = () => true;
    return confirmed(context);
  });
  assert.equal(retainedOriginal, replaced);
  assert.equal(retainedOriginal.cacheOwnershipReleased(), false, 'a replacement callback cannot erase the original owner');
  originallyClosed = true;
  assert.equal(retainedOriginal.cacheOwnershipReleased(), true);
  release(retainedOriginal.storageSession);

  const markerGetterError = Object.freeze(new Error('unknown pending marker getter'));
  const unreadable = new Error('original error with unreadable resource evidence');
  Object.defineProperties(unreadable, { cacheOwnershipPending: { get() { throw markerGetterError; } },
    cacheOwnershipReleased: { value: () => true } });
  Object.freeze(unreadable);
  const unknown = await hold(unreadable, 'unreadable-original-marker', confirmed);
  assert.equal(unknown.cause, unreadable, 'an unreadable marker cannot replace the operation failure with its getter error');
  assert.equal(unknown.cacheOwnershipReleased(), false, 'unreadable original evidence stays unknown');
  // This fixture created metadata only; no resource was ever launched.
  release(unknown.storageSession);

  const ordinary = new Error('settled ordinary operation failure');
  await assert.rejects(runWithStorageSession({ ...input, resourceId: 'ordinary-action-failure' }, async () => { throw ordinary; },
    { settlement: confirmed }), error => error === ordinary);
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);

  const success = await runWithStorageSession({ ...input, resourceId: 'original-observer-success' }, async () => 'complete',
    { settlement: confirmed });
  assert.equal(success.value, 'complete');
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
} finally {
  for (const session of retained) release(session);
  await rmDirRecursive(temporary);
}
console.log('Original storage session closure observation controls authored; execution deferred.');
