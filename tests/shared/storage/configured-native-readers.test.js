import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireNativeReaderStorage, registerNativeReaderStorage, findNativeReaderStorage, getPendingNativeStorageReaders } from '../../../src/shared/storage/native-reader.js';
import { resolveConfiguredNativeStorageSelection } from '../../../src/shared/storage/configured-native-storage.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { getCacheRoot } from '../../../src/shared/cache-roots.js';
import { getRepoId } from '../../../src/shared/repo-paths.js';

// UNVALIDATED: original storage protocol/metadata and inert native lifetime;
// no arbitrary symlinks, copied executables, GUI or native backend invocation.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['sqlite-directory', 'sqlite-file', 'lmdb-directory', 'lmdb-file', 'sidecars', 'selection-change',
  'pending-close', 'failed-open', 'cache-reuse', 'launch-homes', 'unregistered', 'publication-identity', 'canonical-launch'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'configured-reader-'));
const repoRoot = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
const namespace = path.join(temporary, 'explicit-backend');
await fs.mkdir(repoRoot); await fs.mkdir(namespace);
const backend = selected.startsWith('lmdb') ? 'lmdb' : 'sqlite';
const target = backend === 'sqlite' ? path.join(namespace, 'index-code.db') : path.join(namespace, 'index-code');
const direct = selected.endsWith('-file') || selected === 'selection-change';
const userConfig = { cache: { root: cache }, [backend]: direct ? { codeDbPath: target } : { dbDir: namespace } };
const env = { ...process.env, PAIROFCLEATS_HOME: home };
const context = { repoRoot, userConfig, env, nativeBackend: backend, nativeMode: 'code', nativePublicationIdentity: 'selected-generation-1' };
const coordinationRoot = path.join(home, 'state', 'storage-access');
let nativeClosed = false;
const owners = [];
try {
  if (selected === 'canonical-launch') {
    const launchEnv = { ...env, PAIROFCLEATS_CACHE_ROOT: path.join(temporary, 'selected-cache') };
    const selectedCache = getCacheRoot({ env: launchEnv });
    const selectedTarget = path.join(selectedCache, 'repos', getRepoId(repoRoot), 'builds', 'code.db');
    const owner = acquireNativeReaderStorage(selectedTarget, { repoRoot, userConfig: {}, env: launchEnv }, () => nativeClosed);
    owners.push(owner); assert.ok(owner); owner.start();
    assert.equal(owner.selection, null);
    assert.equal((await inspectStorageAccess(selectedCache, { coordinationRoot })).protected, true);
    nativeClosed = true; owner.releaseAfterClosure();
    assert.equal((await inspectStorageAccess(selectedCache, { coordinationRoot })).protected, false);
  } else if (selected === 'unregistered') {
    assert.equal(acquireNativeReaderStorage(path.join(namespace, 'unselected.db'), context, () => true), null);
    assert.equal(acquireNativeReaderStorage(target, { ...context, nativeBackend: undefined }, () => true), null);
    assert.equal(resolveConfiguredNativeStorageSelection(target, { ...context, nativeBackend: '__proto__' }), null);
  } else {
    const owner = acquireNativeReaderStorage(target, context, () => nativeClosed); owners.push(owner);
    assert.ok(owner); assert.equal(owner.selection.deletionAuthority, false); assert.equal(owner.selection.backend, backend);
    const protectedNamespace = owner.selection.namespace;
    assert.equal((await inspectStorageAccess(protectedNamespace, { coordinationRoot })).protected, true);
    if (selected === 'selection-change') {
      userConfig.sqlite.codeDbPath = path.join(namespace, 'other.db');
      assert.throws(() => owner.start(), error => error.code === 'ERR_INDEX_STORAGE_SELECTION');
      owner.releaseAfterClosure(); assert.equal(owner.isSettled(), true);
    } else {
      owner.start();
      if (selected === 'failed-open') owner.failedOpen(Object.freeze(Object.assign(new Error('no native opened'), { code: 'ENOENT' })));
      else {
        if (selected === 'pending-close') {
          assert.throws(() => owner.releaseAfterClosure());
          assert.equal((await inspectStorageAccess(protectedNamespace, { coordinationRoot })).protected, true);
          assert.equal(owner.isSettled(), false);
        }
        if (selected === 'sidecars') for (const suffix of ['', '-wal', '-shm', '-journal']) {
          assert.equal((await inspectStorageAccess(target + suffix, { coordinationRoot })).protected, true);
        }
        if (selected === 'cache-reuse') {
          const resource = {}; registerNativeReaderStorage(resource, owner);
          assert.equal(findNativeReaderStorage(resource, target, context), owner);
          assert.equal(findNativeReaderStorage(resource, target, context), owner);
          assert.equal(getPendingNativeStorageReaders().filter(value => value === owner).length, 1);
        }
        if (selected === 'launch-homes') {
          const otherContext = { ...context, env: { ...env, PAIROFCLEATS_HOME: path.join(temporary, 'other-home') } };
          const second = acquireNativeReaderStorage(target, otherContext, () => nativeClosed); owners.push(second); second.start();
          assert.notEqual(second.session.coordinationRoot, coordinationRoot);
          assert.equal((await inspectStorageAccess(protectedNamespace, { coordinationRoot: second.session.coordinationRoot })).protected, true);
        }
        if (selected === 'publication-identity') {
          assert.match(owner.selection.publicationIdentitySha256, /^[a-f0-9]{64}$/);
          assert.equal(owner.selection.publicationStatus, 'caller-generation-identity');
          assert.equal(resolveConfiguredNativeStorageSelection(target, { ...context, nativePublicationIdentity: null }).publicationStatus, 'unattested');
          assert.notEqual(resolveConfiguredNativeStorageSelection(target, { ...context, nativePublicationIdentity: 'different-generation' }).publicationIdentitySha256,
            owner.selection.publicationIdentitySha256);
        }
        let mutated = false;
        const refused = await withExclusiveStorageAccess(protectedNamespace, async () => { mutated = true; }, { coordinationRoot });
        assert.equal(refused.protected, true); assert.equal(mutated, false);
        nativeClosed = true;
        for (const original of owners) original.releaseAfterClosure();
      }
      assert.equal(owner.isSettled(), true);
    }
    assert.equal((await inspectStorageAccess(protectedNamespace, { coordinationRoot })).protected, false);
    assert.equal(getPendingNativeStorageReaders().includes(owner), false);
  }
  assert.deepEqual(await fs.readdir(namespace), [], 'reader metadata never creates native files or changes user-selected contents');
} finally {
  nativeClosed = true;
  for (const owner of owners) owner.releaseAfterClosure();
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`Configured native reader ownership: ${selected}`);
