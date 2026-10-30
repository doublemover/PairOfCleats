import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withExclusiveRepoCacheCleanup, repoAccessPaths, retainRepoCacheAccess, prepareRepoCacheAccessHandoff } from '../../../src/shared/cache/repo-access.js';
import { withRepoCleanupExclusion } from '../../../src/shared/storage/repo-cleanup-exclusion.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual exclusion/hand-off/publication/category owners. Recovery
// retries exact metadata only, with no native operation or cleanup-work replay.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['generic-pending', 'generic-unmarked', 'generic-settled', 'generic-frozen', 'generic-falsey',
  'generic-metadata-error', 'generic-handoff', 'generic-release-getter', 'generic-replacement',
  'composed-pending', 'composed-unmarked', 'composed-settled', 'composed-frozen', 'composed-falsey',
  'composed-metadata-error', 'composed-revoked-result', 'composed-replacement'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'cleanup-result-owner-'));
const cacheRoot = path.join(root, 'cache'), repoCacheRoot = path.join(cacheRoot, 'repos', 'fixture-repo');
const home = path.join(root, 'home'), coordinationRoot = path.join(home, 'state', 'storage-access');
applyTestEnv({ cacheRoot, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
await fs.mkdir(repoCacheRoot, { recursive: true });
const sentinel = path.join(repoCacheRoot, 'unowned.txt'); await fs.writeFile(sentinel, 'preserved original file');
const composed = selected.startsWith('composed-'), options = { coordinationRoot };
const modernLock = repoAccessPaths(repoCacheRoot, options).lockPath;
const lockPaths = composed ? [repoAccessPaths(repoCacheRoot).lockPath, modernLock] : [modernLock];
const primary = selected.endsWith('falsey') ? null : Object.freeze(new Error('original cleanup failure'));
const secondary = Object.freeze(Object.assign(new Error('original metadata unlink refusal'), { code: 'EACCES' }));
let settled = /settled|release-getter|revoked-result|metadata-error/u.test(selected), calls = 0, getters = 0;
let failure, failed = false, deny = /metadata-error|revoked-result/u.test(selected), savedOwner = null;
const result = { value: 'original result', ...(selected.endsWith('pending') ? { cacheOwnershipPending: true } : {}),
  get cacheOwnershipReleased() { getters++; return function () { assert.equal(this, result); return settled; }; } };
const remove = fs.rm;
fs.rm = async (file, ...args) => {
  if (file === modernLock && deny) {
    if (selected === 'composed-revoked-result') {
      settled = false; Object.defineProperty(result, 'cacheOwnershipReleased', { value: () => true, configurable: true });
    }
    throw secondary;
  }
  return remove(file, ...args);
};
const action = async context => {
  calls++;
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserved original file');
  if (selected.endsWith('frozen') || selected.endsWith('falsey')) throw primary;
  if (selected === 'generic-release-getter') {
    const release = context.lock.release;
    Object.defineProperty(context.lock, 'release', { configurable: true, get() {
      settled = false; Object.defineProperty(result, 'cacheOwnershipReleased', { value: () => true, configurable: true });
      return release;
    } });
  }
  return result;
};
try {
  if (selected === 'generic-handoff') {
    retainRepoCacheAccess(repoCacheRoot, options);
    options.localAccessHandoff = await prepareRepoCacheAccessHandoff(repoCacheRoot, { coordinationRoot,
      drain: async ({ leaseId }) => ({ leaseId, drained: true, pending: false }) });
  }
  let outcome;
  try {
    outcome = composed ? await withRepoCleanupExclusion({ repoCacheRoot, cacheRoot, action })
      : await withExclusiveRepoCacheCleanup(repoCacheRoot, action, options);
  } catch (error) { failure = error; failed = true; }
  assert.equal(calls, 1);
  if (selected.endsWith('settled')) {
    assert.equal(failed, false); assert.equal(outcome.result, result, 'successful return identity is unchanged');
  } else if (selected.endsWith('frozen') || selected.endsWith('falsey')) {
    assert.equal(failed, true); assert.equal(errorGraphIncludes(failure, primary), true);
  } else {
    assert.equal(failed, true);
    savedOwner = composed ? failure.repoCleanupOwner : failure.repoCacheCleanupOwner;
    assert.ok(savedOwner); assert.equal(failure.cacheOwnershipReleased(), false);
    for (const lock of lockPaths) await fs.stat(lock);
    if (composed) assert.equal((await inspectStorageAccess(cacheRoot, { coordinationRoot })).protected, true);
    if (selected === 'generic-handoff') assert.throws(() => retainRepoCacheAccess(repoCacheRoot, options), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
    if (selected.endsWith('replacement')) Object.defineProperty(result, 'cacheOwnershipReleased', { value: () => true, configurable: true });
    if (!settled) await assert.rejects(savedOwner.close(), 'a public positive callback cannot settle the captured original work');
    deny = false; settled = true;
    const inspections = getters;
    await savedOwner.close(); await savedOwner.close();
    assert.equal(getters, inspections, 'successful metadata recovery cannot re-read the original result getter');
    assert.equal(calls, 1, 'cleanup work cannot be replayed'); assert.equal(failure.cacheOwnershipReleased(), true);
    if (selected.includes('metadata-error') || selected === 'composed-revoked-result') assert.equal(errorGraphIncludes(failure, secondary), true);
    else assert.equal(errorGraphIncludes(failure, result), true);
    if (selected === 'generic-handoff') {
      assert.equal((await fs.readdir(repoAccessPaths(repoCacheRoot, options).leases)).length, 1);
      retainRepoCacheAccess(repoCacheRoot, options);
    }
  }
  for (const lock of lockPaths) await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
  if (composed) assert.equal((await inspectStorageAccess(cacheRoot, { coordinationRoot })).protected, false);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserved original file');
} finally {
  deny = false; settled = true; fs.rm = remove; await savedOwner?.close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Cleanup original-result ownership: ${selected}`);
