import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { cleanupFailedSqliteStaging, readSqliteOutputBytes } from '../../../../src/storage/sqlite/build/runner/output-files.js';
import { withSqliteStorageOperation } from '../../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { errorGraphIncludes, errorGraphSome } from '../../../helpers/error-graph.js';

// UNVALIDATED: actual output/cleanup/operation owners with tiny files. Only the
// two native-build cases create a real SQLite database; no subprocess is used.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['size-positive', 'size-zero', 'size-missing', 'size-error', 'size-invalid', 'size-directory', 'size-pending',
  'size-inspection', 'staging-settled', 'staging-primary-pending', 'staging-remove-pending', 'staging-enoent-pending',
  'staging-enoent-settled', 'staging-frozen-failures', 'staging-falsey', 'staging-sidecar-pending',
  'native-build-positive', 'native-build-stat-error'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-output-owner-${selected}`);
const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
let userConfig = { cache: { root: cache } };
const repo = resolveRepoCacheRootPath(repoRoot, userConfig), directory = path.join(repo, 'builds', 'generation', 'index-sqlite');
await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, 'index-code.db'), staged = path.join(directory, 'index-code.db.tmp-fixture');
if (!selected.startsWith('native-')) {
  if (!['size-missing', 'size-directory'].includes(selected)) await fs.writeFile(output, selected === 'size-zero' ? '' : 'indexed source');
  if (selected === 'size-directory') await fs.mkdir(output);
}
if (selected.startsWith('staging-')) {
  if (selected !== 'staging-enoent-settled') await fs.writeFile(staged, 'owned staging');
  await fs.writeFile(`${staged}-wal`, 'owned WAL'); await fs.writeFile(`${staged}-shm`, 'owned SHM');
}
let ready = false, statCalls = 0, mainCalls = 0, sidecarCalls = 0, stats, failure, caught = false, passed = false;
const primary = selected === 'staging-falsey' ? null : Object.freeze(Object.assign(new Error('original SQLite work failure'), {
  ...(selected === 'staging-primary-pending' ? { cacheOwnershipReleased: () => ready } : {})
}));
const cleanup = Object.freeze(Object.assign(new Error('original output metadata/unlink failure'), {
  code: selected.includes('enoent') ? 'ENOENT' : 'EACCES',
  ...(['size-inspection', 'staging-enoent-pending', 'staging-sidecar-pending'].includes(selected) ? { cacheOwnershipReleased: () => ready } : {})
}));
const result = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, result); return ready; } });
const original = { stat: fs.stat, rm: fs.rm };
fs.stat = async (file, ...args) => {
  if (file !== output) return original.stat(file, ...args);
  statCalls++;
  if (['size-error', 'native-build-stat-error'].includes(selected)) throw cleanup;
  stats = await original.stat(file, ...args);
  if (selected === 'size-invalid') stats.size = -1;
  if (selected === 'size-pending') Object.defineProperty(stats, 'cacheOwnershipReleased', { value: result.cacheOwnershipReleased.bind(result) });
  if (selected === 'size-inspection') Object.defineProperty(stats, 'size', { get() { throw cleanup; } });
  return stats;
};
fs.rm = async (file, ...args) => {
  if (file === staged) {
    mainCalls++;
    if (['staging-enoent-pending', 'staging-enoent-settled', 'staging-frozen-failures'].includes(selected)) throw cleanup;
    if (selected === 'staging-remove-pending') return result;
  }
  if ([`${staged}-wal`, `${staged}-shm`].includes(file)) {
    sidecarCalls++; if (selected === 'staging-sidecar-pending' && file.endsWith('-wal')) throw cleanup;
  }
  return original.rm(file, ...args);
};
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protect = async expected => assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, expected);
try {
  let bytes;
  if (selected.startsWith('native-')) {
    const { createBaseIndex, defaultUserConfig } = await import('../../../indexing/validate/helpers.js');
    const { buildSqliteIndex } = await import('../../../../src/storage/sqlite/build/runner.js');
    const { default: Database } = await import('better-sqlite3');
    userConfig = { ...defaultUserConfig, cache: { root: cache } };
    const source = await createBaseIndex({ rootDir: repoRoot, semantic: true });
    const indexDir = path.join(repo, 'builds', 'generation', 'index-code');
    await fs.cp(source.indexDir, indexDir, { recursive: true });
    try {
      const built = await buildSqliteIndex({ root: repoRoot, userConfig, mode: 'code', codeDir: indexDir, out: output,
        compact: false, emitOutput: false, validateMode: 'off', logger: { log() {}, warn() {}, error() {} } });
      assert.equal(built.ok, true);
    } catch (error) { failure = error; caught = true; }
    assert.equal(fsSync.existsSync(output), true, 'the actual native output was published before its readiness size observation');
    const db = new Database(output, { readonly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS total FROM chunks').get().total, 1); }
    finally { db.close(); }
    assert.equal(caught, selected === 'native-build-stat-error');
    if (caught) assert.equal(errorGraphIncludes(failure, cleanup), true);
    assert.ok(statCalls > 0); await protect(false);
  } else {
    try {
      bytes = await withSqliteStorageOperation({ repoRoot, userConfig }, [output, staged], async () => {
        if (selected.startsWith('size-')) return readSqliteOutputBytes(output);
        throw await cleanupFailedSqliteStaging(staged, primary);
      });
    } catch (error) { failure = error; caught = true; }
    if (selected === 'size-positive' || selected === 'size-zero') {
      assert.equal(caught, false); assert.equal(bytes, selected === 'size-zero' ? 0 : Buffer.byteLength('indexed source'));
      await protect(false);
    } else {
      assert.equal(caught, true);
      const pending = ['size-pending', 'size-inspection', 'staging-primary-pending', 'staging-remove-pending',
        'staging-enoent-pending', 'staging-sidecar-pending'].includes(selected);
      if (selected.startsWith('staging-')) assert.equal(errorGraphIncludes(failure, primary), true);
      if (['size-error', 'size-inspection', 'staging-enoent-pending', 'staging-frozen-failures', 'staging-sidecar-pending'].includes(selected)) {
        assert.equal(errorGraphIncludes(failure, cleanup), true);
      }
      if (['staging-primary-pending', 'staging-remove-pending', 'staging-enoent-pending', 'staging-frozen-failures'].includes(selected)) {
        assert.equal(sidecarCalls, 0); assert.equal(await fs.readFile(`${staged}-wal`, 'utf8'), 'owned WAL');
      }
      if (selected === 'staging-primary-pending') assert.equal(mainCalls, 0);
      if (pending) {
        await protect(true);
        let owner; errorGraphSome(failure, value => { owner = value?.sqliteStorageOperation; return Boolean(owner); });
        assert.ok(owner); await assert.rejects(owner.recoverStorageMetadata());
        const counts = [statCalls, mainCalls, sidecarCalls]; ready = true;
        await owner.recoverStorageMetadata(); assert.deepEqual([statCalls, mainCalls, sidecarCalls], counts);
        assert.equal(failure.cacheOwnershipReleased(), true); await protect(false);
      } else await protect(false);
      if (['staging-settled', 'staging-enoent-settled', 'staging-falsey'].includes(selected)) {
        await assert.rejects(fs.stat(staged), { code: 'ENOENT' });
        await assert.rejects(fs.stat(`${staged}-wal`), { code: 'ENOENT' });
        await assert.rejects(fs.stat(`${staged}-shm`), { code: 'ENOENT' });
      }
    }
  }
  passed = true;
} finally {
  fs.stat = original.stat; fs.rm = original.rm; ready = true;
  if (caught) {
    let owner; errorGraphSome(failure, value => { owner = value?.sqliteStorageOperation; return Boolean(owner); });
    if (owner && !owner.isSettled()) await owner.recoverStorageMetadata();
  }
  if (passed) {
    assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(`SQLite output size and failed-stage ownership: ${selected}`);
