import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { retainRepoCacheAccess, prepareRepoCacheAccessHandoff, cancelRepoCacheAccessHandoff,
  withExclusiveRepoCacheCleanup, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual local reader, pre-dispatch resource fence and handoff owner.
// Receipt faults create no native resource or child; unknown cases stay negative.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['positive', 'wrong-lease', 'pending-result', 'pending-error', 'marker-only', 'observer-throw',
  'getter-revocation', 'field-getter-error', 'falsey-error', 'changed-parent', 'fence-release-failure',
  'callback-replacement', 'cancel-positive'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'handoff-drain-owner-'));
const cache = path.join(root, 'cache'), coordinationRoot = path.join(root, 'state', 'storage-access');
const options = { coordinationRoot }, paths = repoAccessPaths(cache, options);
retainRepoCacheAccess(cache, options);
const parentFile = path.join(paths.leases, (await fs.readdir(paths.leases))[0]);
const parentBytes = await fs.readFile(parentFile, 'utf8');
let settled = !['pending-result', 'pending-error', 'marker-only', 'observer-throw', 'callback-replacement'].includes(selected);
let calls = 0, getters = 0, removals = 0, fencePath, failure, failed = false, owner, deny = selected === 'fence-release-failure';
const secondary = Object.freeze(new Error('original drain field/observer failure'));
let receipt;
const pendingError = Object.freeze(Object.assign(new Error('original drain work failure'), {
  cacheOwnershipReleased() { assert.equal(this, pendingError); return settled; }
}));
const remove = fsSync.rmSync;
fsSync.rmSync = (file, ...args) => {
  if (file === fencePath) { removals++; if (deny) throw Object.assign(new Error('controlled original metadata removal denial'), { code: 'EACCES' }); }
  return remove(file, ...args);
};
try {
  let token;
  try { token = await prepareRepoCacheAccessHandoff(cache, { coordinationRoot, drain: async ({ leaseId }) => {
    calls++;
    const records = await Promise.all((await fs.readdir(paths.leases)).map(async file => ({ file: path.join(paths.leases, file),
      record: JSON.parse(await fs.readFile(path.join(paths.leases, file), 'utf8')) })));
    const fence = records.find(item => item.record.scope === 'local-cache-handoff-drain');
    assert.ok(fence, 'durable resource fence must exist before actual drain dispatch'); fencePath = fence.file;
    assert.equal(fence.record.resourceSettlementVersion, 1); assert.equal(fence.record.pid, process.pid);
    assert.equal(records.length, 2); assert.notEqual(fence.record.lockId, leaseId);
    assert.throws(() => retainRepoCacheAccess(cache, options), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
    if (selected === 'pending-error') throw pendingError;
    if (selected === 'falsey-error') throw null;
    if (selected === 'changed-parent') await fs.writeFile(parentFile, JSON.stringify({ ...JSON.parse(parentBytes), lockId: 'replacement-reader' }));
    receipt = { leaseId: selected === 'wrong-lease' ? 'wrong-reader' : leaseId, pending: false,
      get drained() {
        if (selected === 'getter-revocation') settled = false;
        if (selected === 'field-getter-error') throw secondary;
        return true;
      }, ...(selected === 'marker-only' ? { cacheOwnershipPending: true } : {}) };
    if (selected !== 'marker-only') Object.defineProperty(receipt, 'cacheOwnershipReleased', { configurable: true, enumerable: true, get() {
      getters++; return function () {
        assert.equal(this, receipt);
        if (selected === 'observer-throw' && !settled) throw secondary;
        return settled;
      };
    } });
    return receipt;
  } }); } catch (error) { failed = true; failure = error; }
  assert.equal(calls, 1);
  if (['positive', 'cancel-positive'].includes(selected)) {
    assert.equal(failed, false); await assert.rejects(fs.stat(fencePath), { code: 'ENOENT' });
    if (selected === 'cancel-positive') assert.equal(cancelRepoCacheAccessHandoff(token), true);
    else {
      const outcome = await withExclusiveRepoCacheCleanup(cache, async () => {
        assert.equal((await fs.readdir(paths.leases)).length, 0); return 'actual owned mutation';
      }, { ...options, localAccessHandoff: token });
      assert.equal(outcome.result, 'actual owned mutation');
    }
    retainRepoCacheAccess(cache, options);
  } else if (['wrong-lease', 'field-getter-error', 'falsey-error'].includes(selected)) {
    assert.equal(failed, true); retainRepoCacheAccess(cache, options);
    if (selected === 'wrong-lease') assert.match(failure.message, /exact retained lease/u);
    else assert.equal(errorGraphIncludes(failure, selected === 'field-getter-error' ? secondary : null), true);
    await assert.rejects(fs.stat(fencePath), { code: 'ENOENT' });
  } else {
    assert.equal(failed, true); owner = failure.repoCacheHandoffOwner; assert.ok(owner);
    assert.equal(failure.cacheOwnershipReleased(), false); await fs.stat(fencePath);
    assert.throws(() => retainRepoCacheAccess(cache, options), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
    if (selected === 'fence-release-failure') assert.equal(removals, 1, 'failure handling cannot automatically retry metadata release');
    if (selected === 'callback-replacement') Object.defineProperty(receipt, 'cacheOwnershipReleased', { value: () => true });
    if (!settled || selected === 'changed-parent') assert.throws(() => owner.resumeAfterSettlement());
    if (selected === 'marker-only') {
      settled = true; assert.throws(() => owner.resumeAfterSettlement());
      assert.equal(failure.cacheOwnershipReleased(), false, 'no original observer means no settlement proof');
    } else {
      if (selected === 'changed-parent') await fs.writeFile(parentFile, parentBytes);
      deny = false; settled = true; const inspections = getters;
      owner.resumeAfterSettlement(); owner.resumeAfterSettlement();
      assert.equal(getters, inspections, 'recovery uses captured original observers');
      assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(calls, 1);
      retainRepoCacheAccess(cache, options); await assert.rejects(fs.stat(fencePath), { code: 'ENOENT' });
      if (selected === 'pending-error') assert.equal(errorGraphIncludes(failure, pendingError), true);
      if (selected === 'observer-throw') assert.equal(errorGraphIncludes(failure, secondary), true);
    }
  }
  if (selected !== 'marker-only') assert.equal((await fs.readdir(paths.leases)).length, 1, 'only the actual parent reader remains');
} finally {
  deny = false; settled = true; fsSync.rmSync = remove;
  if (selected === 'changed-parent') await fs.writeFile(parentFile, parentBytes);
  // Marker-only is an intentionally unconfirmable metadata-only fixture. Its
  // owner is never acknowledged; only this disposable fixture tree is removed.
  if (owner && selected !== 'marker-only') owner.resumeAfterSettlement();
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Handoff drain original ownership: ${selected}`);
