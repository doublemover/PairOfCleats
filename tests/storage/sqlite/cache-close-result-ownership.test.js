import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteCacheCloseOwner, getSqliteNativeSettlement, addSqliteNativeSettlementHook,
  addSqliteStorageSettlementHook, takeSqliteCacheCloseOwner, getPendingSqliteCacheOwners } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';

// Original-result controls plus real synchronous SQLite close.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['native-pending', 'native-replaced', 'native-inspection', 'native-independent', 'native-revoked',
  'hook-pending', 'closed-pending', 'handoff-pending', 'hook-promise', 'closed-promise', 'hook-ordinary-failure',
  'closed-ordinary-failure', 'closed-before-namespace', 'handoff-original', 'cache-registry', 'native-actual', 'native-actual-pending', 'storage-sibling'];
assert.ok(cases.includes(selected));
let ready = false, secondaryReady = false, inspectReady = false, deny = true;
let nativeCalls = 0, hookCalls = 0, closedCalls = 0, siblingCalls = 0;
const secondary = Object.freeze(Object.assign(new Error('independent original close inspection'), { cacheOwnershipReleased: () => secondaryReady }));
const ordinary = Object.freeze(new Error('original settlement callback failure'));
const result = { cacheOwnershipReleased: () => ready };
if (selected === 'storage-sibling') {
  const db = { close() { nativeCalls++; return this; } };
  const metadataFailure = Object.freeze(Object.assign(new Error('original namespace metadata remains pending'), {
    cacheOwnershipReleased: () => ready
  }));
  const owner = createSqliteCacheCloseOwner(db, { canClose: () => true, onClosed() {},
    onStorageClosed() { hookCalls++; if (deny) throw metadataFailure; } });
  addSqliteStorageSettlementHook(db, () => { siblingCalls++; });
  assert.throws(() => owner.retire(), error => errorGraphIncludes(error, metadataFailure));
  assert.equal(owner.isSettled(), false); assert.equal(siblingCalls, 1);
  assert.throws(() => owner.release()); assert.equal(nativeCalls, 1);
  ready = true; deny = false;
  assert.equal(owner.release().settled, true);
  assert.equal(hookCalls, 2); assert.equal(siblingCalls, 1); assert.equal(nativeCalls, 1);
} else if (selected === 'cache-registry') {
  const { dir: root } = await prepareIsolatedTestCacheDir('sqlite-close-result-cache-registry');
  let passed = false;
  const file = path.join(root, 'identity.db'); await fs.writeFile(file, 'ordinary fixture identity, no native binding');
  const db = { close() { nativeCalls++; return this; } };
  const owner = createSqliteCacheCloseOwner(db, { canClose: () => true, allowCacheHandoff: true,
    onClosed: () => result, onNativeClosed: () => { hookCalls++; } });
  const cache = createSqliteDbCache({ maxEntries: 0 });
  try {
    const lease = cache.setAndAcquire(file, db);
    assert.throws(() => lease.release()); assert.equal(nativeCalls, 1); assert.equal(hookCalls, 0);
    assert.deepEqual(cache.pendingOwners(), [owner]); assert.equal(cache.pendingOwners()[0].db, db);
    assert.throws(() => cache.dispose()); assert.equal(nativeCalls, 1);
    ready = true; assert.equal(owner.release().settled, true);
    assert.deepEqual(cache.pendingOwners(), []);
    cache.dispose(); assert.equal(nativeCalls, 1); assert.equal(hookCalls, 1); passed = true;
  } finally {
    ready = true;
    if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
  }
} else if (selected.startsWith('native-actual')) {
  const { default: Database } = await import('better-sqlite3');
  const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-close-result-${selected}`);
  const db = new Database(path.join(root, 'actual.db')), close = db.close.bind(db);
  let passed = false;
  try {
    if (selected === 'native-actual-pending') Object.defineProperty(db, 'cacheOwnershipReleased', { value: () => ready });
    db.close = () => { nativeCalls++; return close(); };
    const owner = createSqliteCacheCloseOwner(db, { canClose: () => true, onNativeClosed: () => { hookCalls++; }, onClosed: () => { closedCalls++; } });
    if (selected === 'native-actual-pending') {
      assert.throws(() => owner.retire()); assert.equal(db.open, false); assert.equal(nativeCalls, 1); assert.equal(hookCalls, 0);
      assert.throws(() => owner.release()); assert.equal(nativeCalls, 1);
      ready = true; assert.equal(owner.release().settled, true);
    } else assert.equal(owner.retire().settled, true);
    assert.equal(nativeCalls, 1); assert.equal(hookCalls, 1); assert.equal(closedCalls, 1);
    assert.equal(owner.release().settled, true); assert.equal(nativeCalls, 1);
    passed = true;
  } finally {
    ready = true;
    if (db.open) close();
    if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
  }
} else {
  const db = { close() { nativeCalls++; return this; } };
  const nativeResult = ['native-pending', 'native-replaced', 'native-independent', 'native-revoked'].includes(selected);
  if (nativeResult) Object.defineProperty(db, 'cacheOwnershipReleased', { configurable: true, value() {
    assert.equal(this, db);
    if (selected === 'native-independent' && !inspectReady) throw secondary;
    return ready;
  } });
  if (selected === 'native-inspection') Object.defineProperty(db, 'cacheOwnershipReleased', { get() { throw secondary; } });
  if (selected === 'native-revoked') ready = true;
  const owner = createSqliteCacheCloseOwner(db, { canClose: () => true, allowCacheHandoff: selected.startsWith('handoff-'),
    onClosed() {
      closedCalls++;
      if (selected === 'closed-ordinary-failure' && deny) throw ordinary;
      if (selected === 'closed-promise') return Promise.resolve();
      if (['closed-pending', 'closed-before-namespace', 'handoff-pending'].includes(selected)) return result;
    },
    onNativeClosed() {
      hookCalls++;
      if (selected === 'hook-ordinary-failure' && deny) throw ordinary;
      if (selected === 'hook-promise') return Promise.resolve();
      if (selected === 'hook-pending') return result;
    } });
  const physical = getSqliteNativeSettlement(db);
  let storageCalls = 0;
  addSqliteStorageSettlementHook(db, () => { storageCalls++; });
  if (selected === 'hook-ordinary-failure') addSqliteNativeSettlementHook(db, () => { siblingCalls++; });
  if (selected.startsWith('handoff-')) {
    const gate = { canClose: () => true, onClosed() { assert.equal(this, gate); siblingCalls++; } };
    assert.equal(takeSqliteCacheCloseOwner(db, gate), owner);
    gate.onClosed = () => assert.fail('late handoff callback replacement must not be used');
  }
  if (selected === 'native-revoked' || selected === 'handoff-original') {
    assert.equal(owner.retire().settled, true); assert.equal(nativeCalls, 1);
    if (selected === 'native-revoked') {
      ready = false; assert.equal(owner.isSettled(), false); assert.equal(physical(), false);
      assert.throws(() => owner.retire()); assert.ok(getPendingSqliteCacheOwners().includes(owner));
      ready = true; assert.equal(owner.release().settled, true);
      assert.equal(getPendingSqliteCacheOwners().includes(owner), false, 'late reconciliation retires its original pending registry entry');
    }
    assert.equal(nativeCalls, 1); assert.equal(closedCalls, 1); assert.equal(hookCalls, 1);
    if (selected === 'handoff-original') assert.equal(siblingCalls, 1);
  } else {
    let failure;
    assert.throws(() => owner.retire(), error => { failure = error; return true; });
    assert.equal(nativeCalls, 1); assert.equal(owner.isSettled(), false);
    if (selected === 'native-replaced') Object.defineProperty(db, 'cacheOwnershipReleased', { value: () => true });
    if (selected === 'native-inspection' || selected === 'native-independent') assert.ok(errorGraphIncludes(failure, secondary));
    if (nativeResult || selected === 'native-inspection') assert.equal(physical(), false);
    else assert.equal(physical(), true, 'physical native closure does not depend on its metadata-release callbacks');
    if (['closed-pending', 'closed-before-namespace', 'handoff-pending'].includes(selected)) assert.equal(hookCalls, 0);
    assert.equal(storageCalls, 0, 'native/bookkeeping/ordinary settlement prerequisites precede namespace release');
    if (selected === 'handoff-pending') assert.equal(siblingCalls, 0);
    if (selected === 'native-independent') { inspectReady = true; ready = true; }
    if (!['hook-ordinary-failure', 'closed-ordinary-failure'].includes(selected)) assert.throws(() => owner.release());
    assert.equal(nativeCalls, 1);
    if (selected === 'native-inspection' || selected === 'hook-promise' || selected === 'closed-promise') {
      await Promise.resolve(); ready = true; secondaryReady = true;
      assert.throws(() => owner.release()); assert.equal(nativeCalls, 1, 'unknown evidence cannot cause a repeated confirmed close');
    } else {
      ready = true; secondaryReady = true; inspectReady = true; deny = false;
      assert.equal(owner.release().settled, true); assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal(nativeCalls, 1);
      assert.equal(closedCalls, selected === 'closed-ordinary-failure' ? 2 : 1);
      assert.equal(hookCalls, selected === 'hook-ordinary-failure' ? 2 : 1);
      if (selected.startsWith('handoff-') || selected === 'hook-ordinary-failure') assert.equal(siblingCalls, 1);
    }
  }
}
console.log(`SQLite original close/settlement result ownership: ${selected}`);
