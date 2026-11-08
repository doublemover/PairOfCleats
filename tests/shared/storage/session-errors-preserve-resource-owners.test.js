// Actual scoped storage owners with inert failures; source-only, UNVALIDATED.
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runWithStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('storage-session-error-owners-');
const root = path.join(temporary, 'assets');
const coordinationRoot = path.join(temporary, 'state', 'access');
const input = { roots: [root], coordinationRoot, authorizedRoots: [temporary] };
const retained = new Set();
const runFailure = async ({ resourceId, primary, settlement }) => {
  let failure;
  await assert.rejects(runWithStorageSession({ ...input, resourceId }, async () => { throw primary; }, { settlement }), error => {
    failure = error; return true;
  });
  assert.ok(failure.storageSession, 'failed attachment cannot lose the actual session capability');
  retained.add(failure.storageSession);
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('pending resources cannot be collected'), { coordinationRoot })).protected, true);
  return failure;
};
const release = session => {
  session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  retained.delete(session);
};
try {
  let resourceClosed = false;
  const owner = Object.freeze({ exact: 'fixture-resource' });
  const primary = Object.assign(new Error('frozen original cancellation'), {
    name: 'AbortError', code: 'ABORT_ERR', cacheOwnershipPending: true, cacheOwnershipReleased: () => resourceClosed
  });
  Object.defineProperty(primary, 'actualFixtureOwner', { value: owner });
  Object.freeze(primary);
  const frozen = await runFailure({ resourceId: 'frozen-primary', primary,
    settlement: ({ resourceId }) => ({ resourceId, settled: false, pending: true }) });
  assert.ok(frozen instanceof AggregateError);
  assert.equal(frozen.cause, primary);
  assert.equal(frozen.errors[0], primary);
  assert.equal(frozen.code, 'ABORT_ERR');
  assert.equal(frozen.name, 'AbortError');
  assert.equal(frozen.actualFixtureOwner, owner, 'non-enumerable actual resource capability survives the frozen fallback');
  assert.equal(frozen.cacheOwnershipReleased(), false);
  resourceClosed = true;
  assert.equal(frozen.cacheOwnershipReleased(), true, 'original observer is captured without self-recursion');
  release(frozen.storageSession);

  let sourceClosed = false;
  const pending = Object.assign(new Error('actual source owner remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => sourceClosed
  });
  const contradictory = await runFailure({ resourceId: 'contradictory-receipt', primary: pending,
    settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false }) });
  assert.equal(contradictory, pending);
  assert.equal(contradictory.cacheOwnershipReleased(), false,
    'a callback receipt cannot override the original pending owner observation');
  sourceClosed = true; release(contradictory.storageSession);

  let firstClosed = true, secondClosed = false;
  const first = Object.assign(new Error('first owner'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => firstClosed });
  const second = Object.freeze(Object.assign(new Error('second owner'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => secondClosed }));
  const combined = await runFailure({ resourceId: 'two-pending-owners', primary: first, settlement: () => { throw second; } });
  assert.equal(combined, first);
  assert.equal(combined.storageSettlementError, second);
  assert.equal(combined.cacheOwnershipReleased(), false);
  secondClosed = true; assert.equal(combined.cacheOwnershipReleased(), true);
  firstClosed = false; assert.equal(combined.cacheOwnershipReleased(), false);
  firstClosed = true; release(combined.storageSession);

  const readonly = Object.assign(new Error('readonly original observer'), { code: 'EIO', cacheOwnershipPending: true });
  Object.defineProperty(readonly, 'cacheOwnershipReleased', { value: () => true });
  const unknown = Object.freeze(Object.assign(new Error('unknown second owner'), { cacheOwnershipPending: true }));
  const fallback = await runFailure({ resourceId: 'readonly-plus-unknown', primary: readonly, settlement: () => { throw unknown; } });
  assert.ok(fallback instanceof AggregateError);
  assert.equal(fallback.cause, readonly);
  assert.equal(fallback.storageSettlementError, unknown);
  assert.equal(fallback.cacheOwnershipReleased(), false, 'a confirmed primary cannot settle a missing secondary observer');
  // These controls create metadata only; they admit no external fixture owner.
  release(fallback.storageSession);

  let inner;
  const nestedPrimary = new Error('nested owner');
  const nested = await runFailure({ resourceId: 'outer-session', primary: nestedPrimary, settlement: async () => {
    inner = await runFailure({ resourceId: 'inner-session', primary: nestedPrimary,
      settlement: ({ resourceId }) => ({ resourceId, settled: false, pending: true }) });
    throw inner;
  } });
  assert.ok(nested instanceof AggregateError);
  assert.equal(nested.cause, inner);
  assert.notEqual(nested.storageSession, inner.storageSession, 'nested exact handles remain separately reachable');
  release(inner.storageSession); release(nested.storageSession);

  const success = await runWithStorageSession({ ...input, resourceId: 'successful-settlement' }, async () => 'complete', {
    settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false })
  });
  assert.equal(success.value, 'complete');
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
} finally {
  for (const session of retained) release(session);
  await rmDirRecursive(temporary);
}
console.log('Storage session failures preserve exact pending owners and frozen primary evidence.');
