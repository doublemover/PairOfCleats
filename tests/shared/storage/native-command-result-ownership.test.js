import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: real command/session owners with inert handles. No native
// database, child process, filesystem link or permission change is needed.
const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const configured = caseId?.startsWith('configured-');
const selected = configured ? caseId.slice('configured-'.length) : caseId;
const cases = ['operation-pending', 'operation-settled', 'operation-replacement', 'operation-inspection',
  'operation-revoked', 'work-pending', 'work-settled', 'work-replacement',
  'close-pending', 'close-settled', 'close-replacement', 'close-inspection'];
assert.ok(cases.includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`native-command-result-${caseId}`);
const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
const target = path.join(configured ? path.join(root, 'configured') : repoCacheRoot, 'index-code.db');
if (configured) userConfig.sqlite = { codeDbPath: target };
const coordinationRoot = path.join(home, 'state', 'storage-access');
let ready = selected.endsWith('-settled') || selected === 'operation-revoked', inspected = !selected.endsWith('-inspection');
let gets = 0, calls = 0, closes = 0, resources, failure, passed = false;
const secondary = Object.freeze(Object.assign(new Error('independent successful-result observer'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return inspected; }
}));
const result = Object.defineProperties({ payload: 'exact original native result' }, {
  cacheOwnershipReleased: { configurable: true, get() {
    gets++;
    return function () { assert.equal(this, result); if (!inspected) throw secondary; return ready; };
  } }
});
const handle = { close() {
  assert.equal(this, handle); closes++;
  if (selected === 'operation-revoked') ready = false;
  return selected.startsWith('close-') ? result : undefined;
} };
const roots = [cache, repoCacheRoot, target, ...(configured ? [path.dirname(target)] : [])];
const protect = async expected => {
  for (const item of roots) assert.equal((await inspectStorageAccess(item, { coordinationRoot })).protected, expected);
};
try {
  let returned;
  try {
    returned = await runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, async owner => {
      resources = owner;
      owner.admitScope({ repoRoot, repoCacheRoot, userConfig, targets: [target] });
      owner.open(() => handle);
      await protect(true);
      if (selected.startsWith('work-')) {
        try { return await owner.use(handle, () => { calls++; return result; }); }
        catch (error) {
          assert.throws(() => owner.open(() => assert.fail('pending original work must stop another native dispatch')));
          throw error;
        }
      }
      calls++;
      return selected.startsWith('operation-') ? result : 'original operation result';
    });
  } catch (error) { failure = error; }
  assert.equal(calls, 1);
  if (selected.endsWith('-settled')) {
    assert.equal(failure, undefined);
    assert.equal(returned, selected.startsWith('close-') ? 'original operation result' : result);
    assert.equal(closes, 1); assert.equal(resources.isClosed(handle), true); await protect(false);
  } else {
    assert.ok(failure?.nativeDatabaseLifetime);
    assert.equal(errorGraphIncludes(failure, result), true);
    if (selected.endsWith('-inspection')) assert.equal(errorGraphIncludes(failure, secondary), true);
    assert.equal(failure.cacheOwnershipReleased(), false); await protect(true);
    if (selected.endsWith('-replacement')) {
      Object.defineProperty(result, 'cacheOwnershipReleased', { value: () => true, configurable: true });
    }
    const reads = gets;
    await assert.rejects(failure.nativeDatabaseLifetime.recoverStorageMetadata());
    if (selected.startsWith('work-')) {
      assert.equal(closes, 0, 'outstanding accepted work precedes the first native close');
      await assert.rejects(resources.close(handle));
      assert.equal(closes, 0);
    } else assert.equal(closes, 1);
    if (selected.startsWith('close-')) assert.equal(resources.isClosed(handle), false);
    ready = true;
    if (!inspected) {
      await assert.rejects(failure.nativeDatabaseLifetime.recoverStorageMetadata());
      await protect(true); inspected = true;
    }
    if (selected.startsWith('work-')) await resources.close(handle);
    assert.deepEqual(await failure.nativeDatabaseLifetime.recoverStorageMetadata(), { settled: true, pending: false });
    assert.deepEqual(await failure.nativeDatabaseLifetime.recoverStorageMetadata(), { settled: true, pending: false });
    assert.equal(gets, reads, 'metadata recovery never re-reads a replaceable original result getter');
    assert.equal(closes, 1, 'original native closure is invoked once');
    assert.equal(calls, 1, 'original accepted work and operation are never replayed');
    assert.equal(resources.isClosed(handle), true); assert.equal(failure.cacheOwnershipReleased(), true);
    await protect(false);
  }
  passed = true;
} finally {
  ready = true; inspected = true;
  if (failure?.nativeDatabaseLifetime) {
    if (selected.startsWith('work-')) await resources.close(handle);
    await failure.nativeDatabaseLifetime.recoverStorageMetadata();
  }
  if (passed) {
    assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`) && root !== path.resolve('.tmp'));
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(`Native command successful-result ownership: ${caseId}`);
