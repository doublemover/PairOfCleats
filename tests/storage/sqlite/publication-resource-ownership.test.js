import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { replaceSqliteDatabase, removeSqliteSidecars } from '../../../src/storage/sqlite/utils.js';
import { withSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';

// UNVALIDATED: actual rename/removal/recovery and storage owners, tiny files.
// No database opens, subprocess, symlink or permission changes are required.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['pending-enoent', 'pending-exdev', 'pending-eperm', 'rename-result', 'backup-result',
  'remove-result', 'copy-result', 'sidecar-result', 'frozen-restore', 'falsey-restore',
  'diagnostic-inspection', 'healthy-replace', 'healthy-restore'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-publication-owner-${selected}`);
const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const directory = path.join(repo, 'builds', 'generation', 'index-sqlite'); await fs.mkdir(directory, { recursive: true });
const staged = path.join(directory, 'staged.db'), final = path.join(directory, 'final.db'), backup = `${final}.bak`;
await fs.writeFile(staged, 'new indexed source'); await fs.writeFile(final, 'original indexed source');
if (selected === 'remove-result') await fs.writeFile(backup, 'older retained backup');
if (selected === 'sidecar-result') { await fs.writeFile(`${staged}-wal`, 'WAL sentinel'); await fs.writeFile(`${staged}-shm`, 'SHM sentinel'); }
const context = { repoRoot, userConfig }, coordinationRoot = path.join(home, 'state', 'storage-access');
let ready = false, inspected = false, codeReads = 0, renames = 0, removals = 0, copies = 0, failure, passed = false;
const result = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, result); return ready; } });
const secondary = Object.freeze(Object.assign(new Error('independent rename diagnosis'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return inspected; }
}));
const primary = Object.freeze(Object.defineProperties(new Error('original SQLite promotion failed'), {
  code: { get() {
    codeReads++;
    if (selected === 'diagnostic-inspection') throw secondary;
    return selected.startsWith('pending-') ? selected.slice('pending-'.length).toUpperCase() : 'EIO';
  } },
  ...(selected.startsWith('pending-') ? { cacheOwnershipReleased: { value: result.cacheOwnershipReleased.bind(result) } } : {})
}));
const restoreFailure = selected === 'falsey-restore' ? null : Object.freeze(new Error('original frozen restore failure'));
const original = { rename: fs.rename, rm: fs.rm, copyFile: fs.copyFile };
fs.rename = async (from, to) => {
  renames++;
  if (from === staged && to === final && (selected.startsWith('pending-')
    || ['copy-result', 'frozen-restore', 'falsey-restore', 'diagnostic-inspection', 'healthy-restore'].includes(selected))) throw primary;
  if (from === backup && to === final && ['frozen-restore', 'falsey-restore'].includes(selected)) throw restoreFailure;
  const value = await original.rename(from, to);
  return selected === 'backup-result' && from === final || selected === 'rename-result' && from === staged ? result : value;
};
fs.rm = async (file, ...args) => {
  removals++;
  const value = await original.rm(file, ...args);
  return selected === 'remove-result' && file === backup || selected === 'sidecar-result' && file === `${staged}-wal` ? result : value;
};
fs.copyFile = async (...args) => {
  copies++; const value = await original.copyFile(...args); return selected === 'copy-result' ? result : value;
};
const protect = async expected => {
  for (const item of [cache, repo, staged]) assert.equal((await inspectStorageAccess(item, { coordinationRoot })).protected, expected);
};
try {
  try {
    await withSqliteStorageOperation(context, [staged, final, backup], () => selected === 'sidecar-result'
      ? removeSqliteSidecars(staged) : replaceSqliteDatabase(staged, final, { keepBackup: selected === 'copy-result' }));
  } catch (error) { failure = error; }
  if (selected === 'healthy-replace') {
    assert.equal(failure, undefined); assert.equal(await fs.readFile(final, 'utf8'), 'new indexed source');
    await assert.rejects(fs.stat(backup), { code: 'ENOENT' }); await protect(false);
  } else if (['frozen-restore', 'falsey-restore', 'healthy-restore'].includes(selected)) {
    assert.ok(errorGraphIncludes(failure, primary));
    if (selected !== 'healthy-restore') {
      assert.equal(errorGraphIncludes(failure, restoreFailure), true);
      assert.equal(await fs.readFile(backup, 'utf8'), 'original indexed source');
    } else assert.equal(await fs.readFile(final, 'utf8'), 'original indexed source');
    assert.equal(await fs.readFile(staged, 'utf8'), 'new indexed source'); await protect(false);
  } else {
    assert.ok(failure); await protect(true);
    assert.equal(errorGraphIncludes(failure, selected.startsWith('pending-') || selected === 'diagnostic-inspection' ? primary : result), true);
    if (selected === 'diagnostic-inspection') assert.equal(errorGraphIncludes(failure, secondary), true);
    if (selected.startsWith('pending-')) {
      assert.equal(codeReads, 0, 'pending original resource ownership precedes error-code classification');
      assert.equal(renames, 2); assert.equal(removals, 0, 'unknown promotion cannot enter remove fallback');
    }
    if (selected === 'backup-result') assert.equal(renames, 1, 'pending backup move cannot admit promotion');
    if (selected === 'rename-result') assert.equal(await fs.readFile(backup, 'utf8'), 'original indexed source');
    if (selected === 'remove-result') {
      assert.equal(renames, 0); assert.equal(await fs.readFile(final, 'utf8'), 'original indexed source');
    }
    if (selected === 'copy-result') { assert.equal(copies, 1); assert.equal(await fs.readFile(final, 'utf8'), 'original indexed source'); }
    let owner; errorGraphSome(failure, value => { owner = value?.sqliteStorageOperation; return Boolean(owner); });
    assert.ok(owner); await assert.rejects(owner.recoverStorageMetadata());
    const counts = [renames, removals, copies]; ready = true; inspected = true;
    await owner.recoverStorageMetadata(); assert.equal(failure.cacheOwnershipReleased(), true);
    assert.deepEqual([renames, removals, copies], counts, 'metadata recovery cannot replay file mutation or restoration');
    await protect(false);
  }
  passed = true;
} finally {
  fs.rename = original.rename; fs.rm = original.rm; fs.copyFile = original.copyFile; ready = true; inspected = true;
  if (failure) {
    let owner; errorGraphSome(failure, value => { owner = value?.sqliteStorageOperation; return Boolean(owner); });
    if (owner && !owner.isSettled()) await owner.recoverStorageMetadata();
  }
  if (passed) {
    assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(`SQLite publication original file ownership: ${selected}`);
