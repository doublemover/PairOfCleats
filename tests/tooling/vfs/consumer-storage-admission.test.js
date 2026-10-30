import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createVfsMaterializationSession, ensureVfsDiskDocument } from '../../../src/index/tooling/vfs/disk.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual canonical/category admission; no native server or links.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['lifetime', 'admission-race', 'metadata-failure', 'external-root', 'launch-homes', 'multiple-generations', 'pending-file'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'vfs-storage-'));
const repoRoot = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
await fs.mkdir(repoRoot);
const userConfig = { cache: { root: cache } }, env = { ...process.env, PAIROFCLEATS_HOME: home };
const context = { repoRoot, userConfig, env }, repoCache = resolveRepoCacheRootPath(repoRoot, userConfig);
const root = path.join(repoCache, 'builds', 'generation'), coordinationRoot = path.join(home, 'state', 'storage-access');
const protectedAt = async (target, expected, coordination = coordinationRoot) =>
  assert.equal((await inspectStorageAccess(target, { coordinationRoot: coordination })).protected, expected);
const doc = { baseDir: root, virtualPath: 'source.js', text: 'const value = 1;\n', docHash: 'content-one' };
let closed = false, fileReady = false, denyRemoval = false;
const pendingFile = Object.freeze(Object.assign(new Error('original VFS cache work remains outstanding'), {
  cacheOwnershipReleased() { assert.equal(this, pendingFile); return fileReady; }
}));
const scope = createVfsMaterializationSession({ isClosed: () => closed });
const rmSync = fsSync.rmSync;
try {
  if (selected === 'admission-race') {
    await withExclusiveStorageAccess(cache, async () => {
      assert.throws(() => scope.admitRoot(root, context), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      await assert.rejects(ensureVfsDiskDocument({ ...doc, materializationSession: scope }),
        { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' }, 'failed admission prevents later native dispatch');
      await assert.rejects(fs.stat(root), { code: 'ENOENT' });
    }, { coordinationRoot });
    closed = true; scope.releaseAfterClosure();
  } else if (selected === 'external-root') {
    const external = path.join(temporary, 'explicit-external');
    assert.equal(scope.admitRoot(external, context), false); assert.equal(scope.storageRootCount, 0);
    await protectedAt(cache, false); await protectedAt(external, false);
    const result = await ensureVfsDiskDocument({ ...doc, baseDir: external, materializationSession: scope });
    assert.equal(await fs.readFile(result.path, 'utf8'), doc.text);
    closed = true; scope.releaseAfterClosure();
    assert.equal(await fs.readFile(result.path, 'utf8'), doc.text, 'retirement grants no deletion');
  } else {
    assert.equal(scope.admitRoot(root, context), true);
    for (let request = 0; request < 16; request++) assert.equal(scope.admitRoot(root, context), true);
    assert.equal(scope.storageRootCount, 1, 'warm requests reuse their exact root/launch owner');
    let failure;
    try { await ensureVfsDiskDocument({ ...doc, materializationSession: scope,
      ...(selected === 'pending-file' ? { coldStartCache: { set() { throw pendingFile; } } } : {}) }); }
    catch (error) { failure = error; }
    if (selected === 'pending-file') assert.equal(failure, pendingFile); else assert.equal(failure, undefined);
    for (const target of [cache, path.join(cache, 'repos'), repoCache, root]) await protectedAt(target, true);
    assert.equal((await withExclusiveStorageAccess(cache, () => assert.fail('live virtual readers prevent category relocation'), { coordinationRoot })).protected, true);
    if (selected === 'launch-homes') {
      const other = path.join(temporary, 'other-home'), otherCoordination = path.join(other, 'state', 'storage-access');
      assert.equal(scope.admitRoot(root, { ...context, env: { ...env, PAIROFCLEATS_HOME: other } }), true);
      assert.equal(scope.storageRootCount, 2); await protectedAt(root, true, otherCoordination);
    }
    if (selected === 'multiple-generations') {
      const other = path.join(repoCache, 'builds', 'other-generation');
      assert.equal(scope.admitRoot(other, context), true);
      await ensureVfsDiskDocument({ ...doc, baseDir: other, materializationSession: scope });
      assert.equal(scope.storageRootCount, 2); await protectedAt(other, true);
    }
    assert.throws(() => scope.releaseAfterClosure(), 'completed requests cannot retire a live client');
    closed = true;
    if (selected === 'metadata-failure') {
      denyRemoval = true;
      fsSync.rmSync = (file, ...args) => {
        if (denyRemoval && String(file).includes('storage-access') && String(file).endsWith('.json')) throw Object.assign(
          new Error('controlled original metadata removal denial'), { code: 'EACCES' });
        return rmSync(file, ...args);
      };
      assert.throws(() => scope.releaseAfterClosure()); await protectedAt(root, true);
      await assert.rejects(ensureVfsDiskDocument({ ...doc, text: 'replacement', docHash: 'two' }),
        { code: 'ERR_VFS_MATERIALIZATION_CONFLICT' }, 'metadata failure retains the original in-process publication');
      denyRemoval = false;
    }
    if (selected === 'pending-file') {
      assert.throws(() => scope.releaseAfterClosure()); await protectedAt(root, true); fileReady = true;
    }
    scope.releaseAfterClosure();
    for (const target of [cache, path.join(cache, 'repos'), repoCache, root]) await protectedAt(target, false);
    assert.equal((await withExclusiveStorageAccess(cache, () => 'eligible', { coordinationRoot })).result, 'eligible');
  }
} finally {
  fsSync.rmSync = rmSync; closed = true; fileReady = true; scope.releaseAfterClosure();
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`VFS canonical category admission: ${selected}`);
