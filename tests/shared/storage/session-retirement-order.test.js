import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';

// UNVALIDATED: actual owned protocol rows and selective metadata failure;
// no child/native process, arbitrary symlink or real user storage is touched.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['leaf-failure', 'sibling-failures', 'pending-resource', 'observer-error', 'captured-observer', 'partial-progress'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fsp.mkdir(parent, { recursive: true });
const temporary = await fsp.mkdtemp(path.join(parent, 'session-retire-'));
const category = path.join(temporary, 'assets'), group = path.join(category, 'first');
const secondGroup = path.join(category, 'second');
const first = path.join(group, 'leaf'), second = selected === 'partial-progress' ? path.join(secondGroup, 'leaf') : path.join(category, 'second-leaf');
const coordinationRoot = path.join(temporary, 'state', 'access');
await fsp.mkdir(first, { recursive: true }); await fsp.mkdir(second, { recursive: true });
const session = acquireStorageSession({ roots: [first, second],
  authorizedRoots: [category, group, ...(selected === 'partial-progress' ? [secondGroup] : []), path.join(temporary, 'state')], coordinationRoot });
const roots = [category, group, first, second, ...(selected === 'partial-progress' ? [secondGroup] : [])];
const paths = new Map(roots.map(root => [root, repoAccessPaths(root, { coordinationRoot }).leases + path.sep]));
const calls = new Map(roots.map(root => [root, 0]));
const receipt = { resourceId: session.resourceId, settled: true, pending: false };
const releasedAt = async (root, expected) => assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, !expected, root);
const originalRm = fs.rmSync;
let denyFirst = true, denySecond = selected === 'sibling-failures', firstReady = false, secondReady = false, observerGets = 0;
const secondary = Object.freeze(Object.assign(new Error('independent original metadata observer'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return secondReady; }
}));
const nativeFailure = Object.defineProperties(new Error('original metadata resource remains pending'), {
  cacheOwnershipPending: { value: false },
  cacheOwnershipReleased: { get() {
    observerGets++;
    if (selected === 'captured-observer' && observerGets > 1) return () => true;
    return function () { assert.equal(this, nativeFailure); if (selected === 'observer-error' && !firstReady) throw secondary; return firstReady; };
  } }
});
const uncertain = ['pending-resource', 'observer-error', 'captured-observer'].includes(selected);
fs.rmSync = (file, ...args) => {
  const root = typeof file === 'string' && roots.find(root => file.startsWith(paths.get(root)));
  if (root) {
    calls.set(root, calls.get(root) + 1);
    if (root === first && denyFirst || root === second && denySecond) {
      if (uncertain && root === first) throw nativeFailure;
      throw Object.assign(new Error('selective original metadata removal failed'), { code: 'EACCES' });
    }
  }
  return originalRm(file, ...args);
};
try {
  let failure;
  assert.throws(() => session.releaseAfterSettlement(receipt), error => { failure = error; return error.code === 'ERR_STORAGE_SESSION_LEASE_CHANGED'; });
  assert.equal(failure.storageSession, session);
  await releasedAt(first, false); await releasedAt(group, false); await releasedAt(category, false);
  assert.equal(calls.get(category), 0, 'an unresolved descendant retains its exact category lease');
  assert.equal(calls.get(group), 0, 'intermediate admitted ancestors remain protected');
  await releasedAt(second, !denySecond);
  assert.equal(calls.get(second), 1, 'independent sibling release is attempted despite the first failure');
  if (selected === 'partial-progress') {
    await releasedAt(secondGroup, true);
    assert.equal(calls.get(secondGroup), 1, 'an unrelated completed branch can retire its own admitted ancestor');
  }
  if (selected === 'sibling-failures') {
    assert.equal(failure.errors.length, 2, 'both original sibling failures remain represented');
    denyFirst = false;
    assert.throws(() => session.releaseAfterSettlement(receipt));
    await releasedAt(first, true); await releasedAt(group, true); await releasedAt(category, false); await releasedAt(second, false);
    denySecond = false;
  } else if (uncertain) {
    denyFirst = false;
    const attempts = calls.get(first);
    assert.throws(() => session.releaseAfterSettlement(receipt));
    assert.equal(calls.get(first), attempts, 'metadata cannot be retried while the original resource observer remains pending');
    firstReady = true;
    if (selected === 'observer-error') {
      assert.throws(() => session.releaseAfterSettlement(receipt));
      assert.equal(calls.get(first), attempts, 'a settled primary cannot erase an independently pending observer');
      secondReady = true;
    }
  } else denyFirst = false;
  assert.equal(session.releaseAfterSettlement(receipt), true);
  for (const root of roots) await releasedAt(root, true);
  if (selected !== 'sibling-failures') assert.equal(calls.get(second), 1, 'successful sibling removal is never replayed');
  if (selected === 'partial-progress') assert.equal(calls.get(secondGroup), 1, 'successful independent ancestor removal is never replayed');
  const counts = [...calls];
  assert.equal(session.releaseAfterSettlement(receipt), true); assert.deepEqual([...calls], counts, 'settled metadata remains idempotent');
} finally {
  denyFirst = false; denySecond = false; firstReady = true; secondReady = true; fs.rmSync = originalRm;
  session.releaseAfterSettlement(receipt);
  await fsp.rm(temporary, { recursive: true, force: true });
}
console.log(`Storage session descendant retirement: ${selected}`);
