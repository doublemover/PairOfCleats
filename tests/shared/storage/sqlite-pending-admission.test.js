import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { withSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual SQLite work/category leases; independent pending work is
// injected at the existing original observation boundary, never serialized.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['target', 'child', 'inherited', 'observer-child', 'blocked-after-settlement', 'settled-diagnostic', 'overflow',
  'pending-result', 'pending-child-result', 'settled-result', 'observer-result', 'queued-before-failure'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-pending-admission-${selected}`);
const repoRoot = path.join(dir, 'repo'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, context = { repoRoot, userConfig };
const repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const target = path.join(repo, 'builds', 'generation', 'index-sqlite', 'original.db');
const next = path.join(path.dirname(target), 'unadmitted.db');
await fs.mkdir(path.dirname(target), { recursive: true });
const coordinationRoot = path.join(home, 'state', 'storage-access');
let originalSettled = ['settled-diagnostic', 'settled-result'].includes(selected), childSettled = false,
  throwChild = ['observer-child', 'observer-result'].includes(selected);
const child = Object.freeze(Object.assign(new Error('independent original observer resource'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, child); return childSettled; }
}));
const primary = Object.freeze(Object.assign(new Error('original pending storage producer'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() {
    assert.equal(this, primary);
    if (throwChild) { throwChild = false; throw child; }
    return originalSettled;
  }
}));
const resourceResult = Object.freeze({ value: 17, cacheOwnershipPending: true,
  cacheOwnershipReleased() {
    assert.equal(this, resourceResult);
    if (throwChild) { throwChild = false; throw child; }
    return originalSettled;
  }
});
const resultCase = selected.endsWith('result');
let owner, failure, opened = 0, closed = 0, dispatched = 0;
const useNative = file => {
  const db = new Database(file); opened++;
  try { db.exec('CREATE TABLE sample(value INTEGER)'); db.prepare('INSERT INTO sample VALUES (?)').run(17); }
  finally { db.close(); closed++; }
};
try {
  const operation = withSqliteStorageOperation(context, [target], async actual => {
    owner = actual; useNative(target);
    if (resultCase) {
      return selected === 'pending-child-result' ? owner.use(() => resourceResult) : resourceResult;
    }
    const queued = selected === 'queued-before-failure' ? owner.use(() => { dispatched++; useNative(next); }) : null;
    if (selected === 'overflow') {
      for (let index = 0; index < 129; index++) owner.retainFailure(Object.freeze(new Error(`independent original failure ${index}`)));
    } else owner.retainFailure(primary);
    if (selected === 'settled-diagnostic') {
      owner.admitTargets([next]); await owner.use(() => { dispatched++; useNative(next); });
      return;
    }
    if (queued) {
      await assert.rejects(queued, 'accepted but undispatched work rechecks original settlement before dispatch');
    } else if (selected === 'child' || selected === 'observer-child') {
      assert.throws(() => owner.use(() => { dispatched++; useNative(next); }));
    } else if (selected === 'inherited') {
      await assert.rejects(withSqliteStorageOperation(context, [next], () => { dispatched++; useNative(next); }));
    } else assert.throws(() => owner.admitTargets([next]));
    if (selected === 'blocked-after-settlement') {
      originalSettled = true;
      assert.throws(() => owner.admitTargets([next]), 'settling the original work cannot reopen failed admission');
      assert.throws(() => owner.use(() => { dispatched++; }));
    }
    assert.equal((await inspectStorageAccess(repo, { coordinationRoot })).protected, true);
  });
  if (selected === 'settled-diagnostic' || selected === 'settled-result') {
    await operation;
    assert.equal(dispatched, selected === 'settled-diagnostic' ? 1 : 0);
    assert.equal(opened, selected === 'settled-diagnostic' ? 2 : 1); assert.equal(owner.isSettled(), true);
    assert.equal((await inspectStorageAccess(repo, { coordinationRoot })).protected, false);
  } else if (selected === 'blocked-after-settlement') {
    await operation;
    assert.equal(owner.isSettled(), true);
    assert.equal(dispatched, 0);
  } else {
    await assert.rejects(operation, error => { failure = error; return true; });
    if (selected !== 'overflow') assert.ok(errorGraphIncludes(failure, resultCase ? resourceResult : primary));
    if (selected === 'observer-child' || selected === 'observer-result') assert.ok(errorGraphIncludes(failure, child));
    assert.equal(dispatched, 0); assert.equal(opened, 1); assert.equal(owner.isSettled(), false);
    assert.equal((await inspectStorageAccess(repo, { coordinationRoot })).protected, true);
    if (selected !== 'overflow') {
      originalSettled = true;
      if (selected === 'observer-child' || selected === 'observer-result') {
        await assert.rejects(owner.recoverStorageMetadata());
        assert.equal((await inspectStorageAccess(repo, { coordinationRoot })).protected, true);
      }
      childSettled = true;
      await owner.recoverStorageMetadata();
      assert.equal(owner.isSettled(), true);
      assert.equal((await inspectStorageAccess(repo, { coordinationRoot })).protected, false);
    } else await assert.rejects(owner.recoverStorageMetadata(), 'overflow cannot invent complete original observations');
  }
  assert.equal(closed, opened, 'every actual native handle closes once');
  if (selected !== 'settled-diagnostic') await assert.rejects(fs.stat(next), { code: 'ENOENT' });
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`SQLite pending admission ${selected} passed`);
