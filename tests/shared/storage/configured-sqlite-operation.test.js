import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { withSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';

// Real original lease/session/operation owners; no native writer or
// recursive removal of user-selected stores. Actual dispatch is separate.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['namespace', 'batch-order', 'exclusion', 'changed-selection', 'nested-selection', 'ignored-child',
  'metadata-failure', 'unregistered', 'same-namespace'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fsp.mkdir(parent, { recursive: true });
const temporary = await fsp.mkdtemp(path.join(parent, 'configured-sqlite-'));
const repoRoot = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
const namespace = path.join(temporary, 'configured-output'), target = path.join(namespace, 'code.db');
await fsp.mkdir(repoRoot); await fsp.mkdir(namespace);
const env = { ...process.env, PAIROFCLEATS_HOME: home };
const userConfig = { cache: { root: cache }, sqlite: { codeDbPath: target } };
if (selected === 'same-namespace') userConfig.sqlite.proseDbPath = path.join(namespace, 'prose.db');
const context = { repoRoot, userConfig, env }, coordinationRoot = path.join(home, 'state', 'storage-access');
const protectedAt = async (root, expected) => assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected, root);
const recoverOwner = error => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (value.sqliteStorageOperation) return value.sqliteStorageOperation;
    pending.push(value.cause, ...(value instanceof AggregateError ? value.errors : []));
  }
  return null;
};
const originalRm = fs.rmSync;
let denyMetadata = false, recovery;
try {
  if (selected === 'exclusion') {
    let started = false;
    const held = await withExclusiveStorageAccess(namespace, async () => {
      await assert.rejects(withSqliteStorageOperation(context, [target], () => { started = true; }), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
    }, { coordinationRoot });
    assert.equal(held.protected, false); assert.equal(started, false);
  } else if (selected === 'unregistered') {
    const unknown = path.join(temporary, 'unknown-output', 'code.db');
    await withSqliteStorageOperation(context, [unknown], async () => {
      await protectedAt(unknown, false); await protectedAt(path.dirname(unknown), false);
    });
  } else if (selected === 'metadata-failure') {
    const leases = repoAccessPaths(target, { coordinationRoot }).leases;
    fs.rmSync = (file, ...args) => {
      if (denyMetadata && typeof file === 'string' && file.startsWith(leases + path.sep)) {
        throw Object.assign(new Error('original configured resource metadata failure'), { code: 'EACCES' });
      }
      return originalRm(file, ...args);
    };
    let failure;
    await assert.rejects(withSqliteStorageOperation(context, [target], async () => { denyMetadata = true; }), error => { failure = error; return true; });
    recovery = recoverOwner(failure); assert.ok(recovery); assert.equal(recovery.isSettled(), false);
    await protectedAt(namespace, true); await protectedAt(cache, true);
    denyMetadata = false; await recovery.recoverStorageMetadata();
    await protectedAt(namespace, false); await protectedAt(cache, false);
  } else if (selected === 'nested-selection') {
    const secondNamespace = path.join(temporary, 'second-output'), secondTarget = path.join(secondNamespace, 'code.db');
    await fsp.mkdir(secondNamespace);
    await withSqliteStorageOperation(context, [target], async outer => {
      const childContext = { ...context, userConfig: { ...userConfig, sqlite: { codeDbPath: secondTarget } } };
      await withSqliteStorageOperation(childContext, [secondTarget], async inner => {
        assert.notEqual(inner, outer); await protectedAt(namespace, true); await protectedAt(secondNamespace, true);
      });
      await protectedAt(namespace, true); await protectedAt(secondNamespace, false);
    });
  } else if (selected === 'ignored-child') {
    let settle;
    const pending = new Promise(resolve => { settle = resolve; });
    let child;
    const parent = withSqliteStorageOperation(context, [target], async () => {
      child = withSqliteStorageOperation(null, [target + '-wal'], async () => { await pending; });
    });
    // The child announces entry through the real accepted-work owner before the
    // parent may finish. A known event-loop turn observes the retained lease.
    await new Promise(resolve => setImmediate(resolve));
    try { await protectedAt(namespace, true); } finally { settle(); }
    await parent; await child;
  } else {
    const staging = path.join(namespace, 'run-owned-staging.db');
    const paths = selected === 'batch-order' ? [staging, target + '-wal', target]
      : selected === 'same-namespace' ? [target, userConfig.sqlite.proseDbPath] : [target];
    await withSqliteStorageOperation(context, paths, async operation => {
      await protectedAt(namespace, true); await protectedAt(target, true);
      if (selected === 'batch-order') { await protectedAt(staging, true); await protectedAt(target + '-wal', true); }
      if (selected === 'changed-selection') {
        userConfig.sqlite.codeDbPath = path.join(namespace, 'other.db');
        assert.throws(() => operation.admitTargets([staging]), { code: 'ERR_INDEX_STORAGE_SELECTION' });
        assert.throws(() => operation.admitTargets([target]), { code: 'ERR_INDEX_STORAGE_SELECTION' });
      } else if (selected === 'same-namespace') {
        const before = (await inspectStorageAccess(namespace, { coordinationRoot })).owners.length;
        for (let repeat = 0; repeat < 10; repeat++) operation.admitTargets([target, userConfig.sqlite.proseDbPath]);
        assert.equal((await inspectStorageAccess(namespace, { coordinationRoot })).owners.length, before,
          'repeated co-resident mode admission cannot grow metadata owners');
      } else {
        operation.admitTargets([staging, target + '-wal', target + '-shm', target + '-journal']);
        await protectedAt(staging, true);
      }
    });
  }
  await protectedAt(namespace, false);
  assert.deepEqual(await fsp.readdir(namespace), [], 'coordination cannot create or remove native output files');
} finally {
  denyMetadata = false; fs.rmSync = originalRm;
  if (recovery && !recovery.isSettled()) await recovery.recoverStorageMetadata();
  await fsp.rm(temporary, { recursive: true, force: true });
}
console.log(`Configured SQLite operation owner: ${selected}`);
