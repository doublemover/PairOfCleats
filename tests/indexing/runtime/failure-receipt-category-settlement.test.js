import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { acquireBuildRuntimeStorage, closeBuildRuntimeInitialization, finalizeBuildRuntimeInitializationFailure } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual receipt finalization/category owners; inert persistence.
const key = Symbol.for('poc.test.failure-receipt-category');
const state = { write: null };
globalThis[key] = state;
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/index/build/build-state/runtime.js')) return { format: 'module', shortCircuit: true,
    source: 'export const persistRuntimeAttempt = (...args) => globalThis[Symbol.for("poc.test.failure-receipt-category")].write(...args);' };
  return next(url, context);
} });
const temporary = await makeTempDir('poc-failed-receipt-category-');
try {
  const { withRuntimeReceiptInitialization } = await import('../../../src/index/build/runtime/receipt.js');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(repo);
  for (const failRecord of [true, false]) {
    const variant = failRecord ? 'pending' : 'recorded';
    const home = path.join(temporary, variant, 'home'), cache = path.join(temporary, variant, 'cache');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    const primary = Object.freeze(Object.assign(new Error('original frozen initialization error'), {
      code: 'EIO', cleanupErrors: 'prior diagnostic is not an array'
    }));
    const secondary = Object.freeze(Object.assign(new Error('failed failure receipt'), { code: 'ENOSPC' }));
    let protectedDuringRecord = false;
    state.write = async () => {
      protectedDuringRecord = (await inspectStorageAccess(cache, { coordinationRoot })).protected;
      if (failRecord) throw secondary;
      return null;
    };
    let failure;
    try {
      await withRuntimeReceiptInitialization(async onAttempt => {
        onAttempt({ attemptId: 'inert-persistence-fixture' }, path.join(cache, 'build'));
        throw await closeBuildRuntimeInitialization({ initialization: createLifecycleRegistry(), error: primary, owner });
      }, { finalizeFailure: input => finalizeBuildRuntimeInitializationFailure({ ...input, owner }) });
    } catch (error) { failure = error; }
    assert.equal(protectedDuringRecord, true, 'unwind completion alone does not release the category before failure recording');
    if (failRecord) {
      assert.equal(failure.cause, primary);
      assert.equal(failure.errors[1], secondary);
      assert.deepEqual(failure.cleanupErrors, [secondary]);
      assert.equal(failure.cacheOwnershipPending, true);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
      owner.session.releaseAfterSettlement({ resourceId: owner.session.resourceId, settled: true, pending: false });
      assert.equal(failure.cacheOwnershipReleased(), false, 'fixture metadata cleanup is not a production recording settlement claim');
    } else {
      assert.equal(failure, primary);
      assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
    }
  }
  let caseId = 0;
  const ownCase = async () => {
    const directory = path.join(temporary, `exact-failure-${caseId++}`);
    const home = path.join(directory, 'home'), cache = path.join(directory, 'cache');
    const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
    return { owner, cache, coordinationRoot: path.join(home, 'state', 'storage-access') };
  };
  const protectedCase = input => inspectStorageAccess(input.cache, { coordinationRoot: input.coordinationRoot });
  // Fixture metadata disposal is not a production cleanup/recovery receipt.
  const disposeCase = input => input.owner.session.releaseAfterSettlement({
    resourceId: input.owner.session.resourceId, settled: true, pending: false
  });
  for (const value of [undefined, null, false, 0, '']) {
    const primary = Object.freeze(Object.assign(new Error('frozen primary with falsey cleanup'), { code: 'EIO' }));
    const cleanupCase = await ownCase();
    try {
      const initialization = createLifecycleRegistry();
      initialization.registerCleanup(() => { throw value; });
      const unwound = await closeBuildRuntimeInitialization({ initialization, error: primary, owner: cleanupCase.owner });
      assert.equal(unwound.cause, primary);
      assert.deepEqual(unwound.cleanupErrors, [value]);
      assert.equal(unwound.errors[1], value);
      const failure = finalizeBuildRuntimeInitializationFailure({ error: unwound, owner: cleanupCase.owner, recordingFailed: false });
      assert.equal(failure.cause, unwound);
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await protectedCase(cleanupCase)).protected, true, 'falsey cleanup cannot release initialization storage');
      assert.equal(Object.hasOwn(primary, 'cleanupErrors'), false);
    } finally { disposeCase(cleanupCase); }

    const recordCase = await ownCase();
    try {
      let flag;
      state.write = async () => { throw value; };
      const failure = await withRuntimeReceiptInitialization(async onAttempt => {
        onAttempt({ attemptId: 'falsey-recording-failure' }, path.join(recordCase.cache, 'build'));
        throw await closeBuildRuntimeInitialization({ initialization: createLifecycleRegistry(), error: primary, owner: recordCase.owner });
      }, { finalizeFailure: input => {
        flag = input.recordingFailed;
        return finalizeBuildRuntimeInitializationFailure({ ...input, owner: recordCase.owner });
      } }).then(() => assert.fail('the operation failed'), error => error);
      assert.equal(flag, true, 'the actual receipt wrapper forwards failure presence independently of its value');
      assert.equal(failure.cause, primary);
      assert.deepEqual(failure.cleanupErrors, [value]);
      assert.equal(failure.errors[1], value);
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await protectedCase(recordCase)).protected, true);
    } finally { disposeCase(recordCase); }

    const successfulCleanup = await ownCase();
    try {
      state.write = async () => null;
      const outcome = await withRuntimeReceiptInitialization(async onAttempt => {
        onAttempt({ attemptId: 'falsey-primary-confirmed-cleanup' }, path.join(successfulCleanup.cache, 'build'));
        throw await closeBuildRuntimeInitialization({ initialization: createLifecycleRegistry(), error: value, owner: successfulCleanup.owner });
      }, { finalizeFailure: input => finalizeBuildRuntimeInitializationFailure({ ...input, owner: successfulCleanup.owner }) })
        .then(() => ({ rejected: false }), error => ({ rejected: true, error }));
      assert.equal(outcome.rejected, true);
      assert.equal(outcome.error, value, 'confirmed cleanup preserves the exact original falsey failure');
      assert.equal((await protectedCase(successfulCleanup)).protected, false);
    } finally { disposeCase(successfulCleanup); }

    const noOwner = await closeBuildRuntimeInitialization({
      initialization: { async close() { throw value; } }, error: primary
    });
    assert.equal(noOwner.cause, primary);
    assert.deepEqual(noOwner.cleanupErrors, [value]);
    state.write = async () => { throw value; };
    const noFinalizer = await withRuntimeReceiptInitialization(async onAttempt => {
      onAttempt({ attemptId: 'falsey-recording-without-finalizer' }, path.join(temporary, 'inert-build'));
      throw primary;
    }).then(() => assert.fail('the operation failed'), error => error);
    assert.equal(noFinalizer.cause, primary);
    assert.deepEqual(noFinalizer.cleanupErrors, [value]);
  }

  const observedCase = await ownCase();
  try {
    let settled = false, reads = 0;
    const primary = new Error('original observation survives replacement');
    Object.defineProperties(primary, {
      cacheOwnershipPending: { value: false },
      cacheOwnershipReleased: { configurable: true, get() {
        reads++;
        return function () { assert.equal(this, primary); return settled; };
      } }
    });
    const initialization = createLifecycleRegistry();
    const failure = await closeBuildRuntimeInitialization({ initialization, error: primary, owner: observedCase.owner });
    Object.defineProperty(primary, 'cacheOwnershipReleased', { value: () => true });
    const rejectedRelease = finalizeBuildRuntimeInitializationFailure({ error: failure, recordingFailed: false, owner: observedCase.owner });
    assert.equal(rejectedRelease.cacheOwnershipReleased(), false);
    assert.equal((await protectedCase(observedCase)).protected, true);
    assert.equal(reads, 1, 'the original method is captured once with its original receiver');
    settled = true;
    await closeBuildRuntimeInitialization({ initialization, error: primary, owner: observedCase.owner });
    finalizeBuildRuntimeInitializationFailure({ error: failure, recordingFailed: false, owner: observedCase.owner });
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await protectedCase(observedCase)).protected, false);
  } finally { disposeCase(observedCase); }

  const firstCase = await ownCase(), siblingCase = await ownCase();
  try {
    let settled = false;
    const primary = Object.freeze(Object.assign(new Error('independent first runtime owner'), {
      cacheOwnershipReleased() { return settled; }
    }));
    const firstInitialization = createLifecycleRegistry(), siblingInitialization = createLifecycleRegistry();
    const firstFailure = await closeBuildRuntimeInitialization({ initialization: firstInitialization, error: primary, owner: firstCase.owner });
    const siblingFailure = await closeBuildRuntimeInitialization({ initialization: siblingInitialization, error: firstFailure, owner: siblingCase.owner });
    finalizeBuildRuntimeInitializationFailure({ error: siblingFailure, recordingFailed: false, owner: siblingCase.owner });
    assert.equal((await protectedCase(siblingCase)).protected, true, 'another producer owner cannot be excluded as self-metadata');
    settled = true;
    assert.equal(firstFailure.cacheOwnershipReleased(), false, 'resource completion alone cannot stand in for category release');
    await closeBuildRuntimeInitialization({ initialization: firstInitialization, error: primary, owner: firstCase.owner });
    finalizeBuildRuntimeInitializationFailure({ error: firstFailure, recordingFailed: false, owner: firstCase.owner });
    assert.equal(firstFailure.cacheOwnershipReleased(), true);
    await closeBuildRuntimeInitialization({ initialization: siblingInitialization, error: firstFailure, owner: siblingCase.owner });
    finalizeBuildRuntimeInitializationFailure({ error: siblingFailure, recordingFailed: false, owner: siblingCase.owner });
    assert.equal((await protectedCase(siblingCase)).protected, false);
  } finally { disposeCase(firstCase); disposeCase(siblingCase); }

  const secondary = Object.freeze(new Error('diagnostic getter failed'));
  const guardedPrimary = Object.create(null, { message: { get() { throw secondary; } } });
  const noOwner = await closeBuildRuntimeInitialization({
    initialization: { async close() { throw false; } }, error: guardedPrimary
  });
  assert.equal(noOwner.cause, guardedPrimary);
  assert.ok(noOwner.errors.includes(secondary), 'diagnostic inspection cannot replace or silently erase an original failure');
  assert.deepEqual(noOwner.cleanupErrors, [false]);
} finally { hooks.deregister(); delete globalThis[key]; await rmDirRecursive(temporary); }
console.log('Failure recording stays within actual runtime category ownership.');
