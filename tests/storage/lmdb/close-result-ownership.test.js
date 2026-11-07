import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLmdbCloseOwner } from '../../../src/storage/lmdb/close.js';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// UNVALIDATED: real close/command/session owners; inert native methods, no
// actual native handle, process, symlink or installation is created.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['settled', 'early-return', 'callback-before-return', 'pending-result', 'replacement-before-callback',
  'inspection', 'marker', 'explicit-false', 'rejected-native', 'frozen-native', 'falsey-native',
  'callback-then-reject', 'method-snapshot', 'result-revoked', 'command-pending', 'configured-command-pending',
  'command-revoked', 'configured-command-revoked'].includes(selected));
let ready = !['pending-result', 'replacement-before-callback', 'inspection', 'command-pending',
    'configured-command-pending'].includes(selected), inspected = selected !== 'inspection';
let callback, entered, finishResult, calls = 0, gets = 0, failure;
const announced = new Promise(resolve => { entered = resolve; });
const returnGate = new Promise(resolve => { finishResult = resolve; });
const secondary = Object.freeze(Object.assign(new Error('independent close-result inspection'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return inspected; }
}));
const originalFailure = selected === 'falsey-native' ? null : Object.freeze(new Error('original native close rejected'));
const result = Object.defineProperties({ payload: 'original close result' }, {
  ...(selected === 'marker' ? { cacheOwnershipPending: { value: true } } : {
    cacheOwnershipReleased: { configurable: true, get() {
      gets++; return function () { assert.equal(this, result); if (!inspected) throw secondary; return ready; };
    } }
  })
});
const nativeFailure = ['explicit-false', 'rejected-native', 'frozen-native', 'falsey-native', 'callback-then-reject'].includes(selected);
const handle = { close(done) {
  assert.equal(this, handle); calls++; callback = done; entered();
  if (selected === 'explicit-false') return false;
  if (['rejected-native', 'frozen-native', 'falsey-native'].includes(selected)) throw originalFailure;
  if (selected === 'callback-then-reject') { done(); return Promise.reject(originalFailure); }
  if (selected === 'callback-before-return') { done(); return returnGate.then(() => result); }
  if (selected.includes('command-')) done();
  return result;
} };
if (selected.includes('command-')) {
  const { dir: root } = await prepareIsolatedTestCacheDir(`lmdb-close-result-${selected}`);
  const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home');
  await fs.mkdir(repoRoot);
  applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const userConfig = { cache: { root: cache } }, repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  const target = path.join(selected.startsWith('configured-') ? path.join(root, 'configured') : repoCacheRoot, 'index-code');
  if (selected.startsWith('configured-')) userConfig.lmdb = { codeDbPath: target };
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  let resources, passed = false;
  const protect = async expected => {
    for (const item of [cache, repoCacheRoot, target]) assert.equal((await inspectStorageAccess(item, { coordinationRoot })).protected, expected);
  };
  try {
    await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async owner => {
      resources = owner; owner.admitScope({ repoRoot, repoCacheRoot, userConfig, targets: [target] });
      owner.open(() => handle); await protect(true);
      if (selected.endsWith('-revoked')) { await owner.close(handle); ready = false; }
      return 'original command work';
    }), error => { failure = error; return Boolean(error.nativeDatabaseLifetime); });
    assert.equal(calls, 1); assert.equal(resources.isClosed(handle), false);
    await protect(true); await assert.rejects(failure.nativeDatabaseLifetime.recoverStorageMetadata());
    Object.defineProperty(result, 'cacheOwnershipReleased', { configurable: true, value: () => true });
    await assert.rejects(failure.nativeDatabaseLifetime.recoverStorageMetadata());
    ready = true;
    await failure.nativeDatabaseLifetime.recoverStorageMetadata();
    assert.equal(calls, 1); assert.equal(resources.isClosed(handle), true);
    assert.equal(failure.cacheOwnershipReleased(), true); await protect(false); passed = true;
  } finally {
    ready = true;
    await failure?.nativeDatabaseLifetime.recoverStorageMetadata();
    if (passed) {
      assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`));
      await fs.rm(root, { recursive: true, force: true });
    }
  }
} else {
  const closeOwner = createLmdbCloseOwner(handle, handle.close);
  if (selected === 'method-snapshot') handle.close = () => assert.fail('captured native close cannot be replaced');
  let fulfilled = false;
  const first = closeOwner.close();
  assert.equal(closeOwner.close(), first);
  const observed = first.then(value => { fulfilled = true; return { value }; }, error => ({ error }));
  await announced;
  if (!nativeFailure) {
    assert.equal(closeOwner.isSettled(), false);
    if (selected === 'callback-before-return') {
      assert.equal(closeOwner.isPhysicallyClosed(), false); finishResult();
    } else {
      await Promise.resolve(); await Promise.resolve();
      assert.equal(fulfilled, false, 'an early fulfilled return cannot replace the native callback');
      if (selected === 'replacement-before-callback') Object.defineProperty(result, 'cacheOwnershipReleased', {
        configurable: true, value: () => true
      });
      callback();
    }
  }
  const outcome = await observed;
  if (nativeFailure) {
    failure = outcome.error; assert.ok(failure);
    if (selected !== 'explicit-false') assert.equal(errorGraphIncludes(failure, originalFailure), true);
    callback(); ready = true; inspected = true;
    assert.equal(closeOwner.isPhysicallyClosed(), false);
    assert.equal(closeOwner.isSettled(), false);
    assert.equal(failure.cacheOwnershipReleased(), false, 'a later callback cannot acknowledge an originally failed native call');
  } else if (['pending-result', 'replacement-before-callback', 'inspection', 'marker'].includes(selected)) {
    failure = outcome.error; assert.ok(failure);
    assert.equal(errorGraphIncludes(failure, result), true);
    if (selected === 'inspection') assert.equal(errorGraphIncludes(failure, secondary), true);
    assert.equal(closeOwner.isPhysicallyClosed(), true);
    assert.equal(closeOwner.isSettled(), false);
    const reads = gets; ready = true;
    if (!inspected) { assert.equal(closeOwner.isSettled(), false); inspected = true; }
    assert.equal(closeOwner.isSettled(), selected !== 'marker');
    assert.equal(failure.cacheOwnershipReleased(), selected !== 'marker');
    assert.equal(gets, reads);
  } else {
    assert.equal(outcome.error, undefined); assert.equal(fulfilled, true);
    assert.equal(closeOwner.isPhysicallyClosed(), true); assert.equal(closeOwner.isSettled(), true);
    if (selected === 'result-revoked') { ready = false; assert.equal(closeOwner.isSettled(), false); ready = true; }
  }
  const reads = gets;
  assert.equal(closeOwner.close(), first);
  if (failure) await assert.rejects(closeOwner.close(), error => error === failure);
  else await closeOwner.close();
  assert.equal(gets, reads); assert.equal(calls, 1);
}
console.log(`LMDB original close-result ownership: ${selected}`);
