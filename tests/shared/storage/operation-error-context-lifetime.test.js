import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addStorageFailureContext, readStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { releaseStorageOperationLock } from '../../../src/shared/storage/operation-lock.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: authored original diagnostics/receiver and disposable owner controls.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};

const mutable = new Error('mutable primary');
assert.equal(addStorageFailureContext(mutable, { phase: 'observation' }), mutable);
assert.equal(mutable.phase, 'observation');
for (const value of [undefined, null, false, 0, '']) {
  const primary = Object.freeze(new Error('original primary'));
  const failure = addStorageFailureContext(primary, {}, value, { secondaryPresent: true });
  assert.equal(failure.cause, primary);
  assert.equal(failure.errors.length, 2);
  assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
  assert.equal(failure.errors[1].cause, value);
  assert.equal(addStorageFailureContext(value, {}).cause, value);
}
assert.equal(addStorageFailureContext(Object.freeze(new Error('legacy no secondary')), {}, null).errors.length, 1);

{
  let messageReads = 0, codeReads = 0, settled = false;
  const primary = new Error('replaced before freeze');
  delete primary.stack;
  Object.defineProperties(primary, {
    message: { get() { assert.equal(this, primary); messageReads += 1; return 'original diagnostic message'; } },
    code: { get() { assert.equal(this, primary); codeReads += 1; return 'EORIGINAL'; }, enumerable: true },
    cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; } }
  });
  Object.freeze(primary);
  const failure = addStorageFailureContext(primary, { context: 'readonly' });
  assert.equal(messageReads, 1); assert.equal(codeReads, 0);
  assert.equal(failure.message, 'original diagnostic message'); assert.equal(failure.code, 'EORIGINAL');
  assert.equal(codeReads, 1); assert.equal(messageReads, 1);
  assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').configurable, false);
  assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.throws(() => { failure.code = 'REPLACED'; }, TypeError);
}
for (const thrown of [undefined, null, false, 0, '']) {
  let reads = 0;
  const primary = new Error('message getter failure');
  delete primary.stack;
  Object.freeze(Object.defineProperty(primary, 'message', {
    get() { reads += 1; throw thrown; }
  }));
  const failure = addStorageFailureContext(primary, { phase: 'diagnostic' });
  assert.equal(reads, 1); assert.equal(failure.cause, primary);
  const inspection = readStorageFailureContext(failure).inspectionErrors[0];
  assert.equal(inspection.cause, thrown); assert.equal(contains(failure, inspection), true);
  assert.equal(readStorageFailureContext(failure).complete, true);
}
{
  let stackDescriptors = 0, messages = 0;
  const target = Object.freeze(new Error('lazy stack descriptor remains untouched'));
  const primary = new Proxy(target, {
    get(actual, key, receiver) { if (key === 'message') messages += 1; return Reflect.get(actual, key, receiver); },
    getOwnPropertyDescriptor(actual, key) {
      if (key === 'stack') { stackDescriptors += 1; throw new Error('lazy stack descriptor must not be requested'); }
      return Object.getOwnPropertyDescriptor(actual, key);
    }
  });
  const failure = addStorageFailureContext(primary, { phase: 'lazy-stack' });
  assert.equal(failure.cause, primary); assert.equal(messages, 1); assert.equal(stackDescriptors, 0);
}
{
  let nativeSettled = false, throwObservation = true;
  const inspection = Object.freeze(Object.assign(new Error('late native inspection failure'), {
    cacheOwnershipReleased() { assert.equal(this, inspection); return nativeSettled; }
  }));
  const primary = Object.freeze(Object.assign(new Error('original observer may throw'), {
    cacheOwnershipReleased() { assert.equal(this, primary); if (throwObservation) throw inspection; return true; }
  }));
  const failure = addStorageFailureContext(primary, { phase: 'late-observation' });
  Object.freeze(failure.errors); Object.freeze(failure);
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.equal(readStorageFailureContext(failure).inspectionErrors.includes(inspection), true);
  throwObservation = false;
  assert.equal(failure.cacheOwnershipReleased(), false, 'a later successful primary observer cannot erase the original secondary owner');
  nativeSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  const additional = addStorageFailureContext(failure, { phase: 'outer-context' });
  assert.equal(readStorageFailureContext(additional).inspectionErrors.includes(inspection), true);
  assert.equal(additional.cause, failure);
}
{
  let settled = false;
  const inspection = Object.assign(new Error('late accessor owns native work'), {
    cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
  });
  const primary = Object.freeze(Object.defineProperty(new Error('late accessor without earlier resource marker'), 'code', {
    get() { throw inspection; }
  }));
  const failure = addStorageFailureContext(primary, { phase: 'late-accessor' });
  Object.freeze(failure.errors); Object.freeze(failure);
  assert.equal(failure.cacheOwnershipPending, false); assert.equal(failure.cacheOwnershipReleased(), true);
  assert.throws(() => failure.code, error => error === inspection);
  inspection.cacheOwnershipReleased = () => true;
  assert.equal(failure.cacheOwnershipPending, true); assert.equal(failure.cacheOwnershipReleased(), false);
  const observation = readStorageFailureContext(failure).inspectionObservations[0];
  assert.equal(observation.error, inspection); assert.equal(observation.observe(), false);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(observation.observe(), true);
}
{
  let primarySettled = false, contextSettled = false;
  const primary = Object.assign(new Error('original owner'), {
    cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return primarySettled; }
  });
  const fields = { phase: 'requested context', cacheOwnershipPending: true,
    cacheOwnershipReleased() { assert.equal(this, fields); return contextSettled; } };
  const failure = addStorageFailureContext(primary, fields);
  contextSettled = true; assert.equal(failure.cacheOwnershipReleased(), false);
  primarySettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
{
  let nativeSettled = false;
  const inspection = Object.freeze(Object.assign(new Error('original unreadable marker inspection'), {
    cacheOwnershipReleased() { assert.equal(this, inspection); return nativeSettled; }
  }));
  const primary = Object.freeze(Object.defineProperty(new Error('unreadable ownership marker'), 'cacheOwnershipPending', {
    get() { throw inspection; }
  }));
  const failure = addStorageFailureContext(primary, { phase: 'unknown' });
  assert.equal(contains(failure, inspection), true); nativeSettled = true;
  assert.equal(failure.cacheOwnershipReleased(), false, 'unreadable original ownership remains unknown');
  assert.equal(readStorageFailureContext({ storageContextInspectionErrors: [inspection], complete: true }), null);
}
{
  const inspection = Object.freeze(new Error('context property inspection'));
  const fields = Object.defineProperty({ phase: 'known surrounding context' }, 'unreadable', { enumerable: true, get() { throw inspection; } });
  const primary = Object.freeze(Object.defineProperty(new Error('readonly data code'), 'code', { value: 'EORIGINAL', enumerable: true }));
  const failure = addStorageFailureContext(primary, fields);
  assert.equal(failure.phase, 'known surrounding context'); assert.equal(failure.code, 'EORIGINAL');
  assert.deepEqual(Object.getOwnPropertyDescriptor(failure, 'code'), Object.getOwnPropertyDescriptor(primary, 'code'));
  assert.equal(contains(failure, inspection), true);
}

const root = await makeTempDir('poc-storage-error-context-');
const lstat = fs.lstat, remove = fs.rm;
try {
  const home = path.join(root, 'home'), source = path.join(root, 'source'), target = path.join(root, 'target');
  await fs.mkdir(home); await fs.mkdir(source); await fs.mkdir(target);
  fs.lstat = async (file, ...args) => {
    if (file === source) throw false;
    if (file === target) throw undefined;
    return lstat(file, ...args);
  };
  const failure = await rejected(() => planStorageConfiguration({ layout: resolveStorageLayout({ home, env: {} }),
    category: 'models', currentPath: source, target }));
  assert.equal(failure.cause.cause, false);
  assert.equal(failure.errors[1].cause, undefined);
  assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
  assert.equal(readStorageLocator(home).status, 'missing'); fs.lstat = lstat;
  for (const value of [false, 0, '']) {
    const lockPath = path.join(root, `operation-${String(value).length}-${String(value)}.lock`);
    const lock = await acquireFileLock({ lockPath, waitMs: 0, metadata: { scope: 'storage-context-fixture' } });
    assert.ok(lock);
    fs.rm = async (file, ...args) => { if (file === lockPath) throw null; return remove(file, ...args); };
    const error = await rejected(() => releaseStorageOperationLock(lock, value));
    assert.equal(error.cause.cause, value); assert.equal(error.storageOperationLocks[0], lock);
    assert.equal(error.errors[1].cause, null); assert.equal((await lstat(lockPath)).isFile(), true);
    assert.equal(Object.keys(error).includes('storageOperationLocks'), false);
    fs.rm = remove; assert.equal(await lock.release(), true);
  }
} finally { fs.lstat = lstat; fs.rm = remove; await rmDirRecursive(root); }
console.log('Storage failure context preserves original diagnostics, receivers and falsey independent failures.');
