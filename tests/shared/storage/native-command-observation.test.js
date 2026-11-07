import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual namespace leases with inert resource observations, zero
// native handles and no subprocess/debugger/platform permission changes.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['mutable', 'frozen', 'callable', 'captured-callback', 'admission-inspection', 'marker-getter'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'native-command-observe-'));
const repoRoot = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
await fs.mkdir(repoRoot);
const userConfig = { cache: { root: cache } }, env = { ...process.env, PAIROFCLEATS_HOME: home };
const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig), target = path.join(repoCacheRoot, 'generation', 'code.db');
const coordinationRoot = path.join(home, 'state', 'storage-access');
const primary = selected === 'callable' ? function thrownOriginal() { assert.fail('resource errors must not be invoked as diagnostics'); }
  : new Error('original native command work observation');
let firstReady = false, secondReady = false, gets = 0, failure;
const secondary = Object.freeze(Object.assign(new Error('independently pending original inspection'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return secondReady; }
}));
Object.defineProperties(primary, {
  cacheOwnershipPending: selected === 'marker-getter' ? { get() { throw secondary; } } : { value: false },
  cacheOwnershipReleased: { get() {
    gets++;
    if (selected === 'captured-callback' && gets > 1) return () => true;
    return function () { assert.equal(this, primary); if (selected !== 'captured-callback' && !firstReady) throw secondary; return firstReady; };
  } }
});
if (selected === 'frozen') Object.freeze(primary);
const protectedAt = async expected => assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, expected);
try {
  await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, resources => {
    if (selected === 'marker-getter') throw primary; // No asset/metadata admission for an unknowable synthetic owner.
    if (selected === 'admission-inspection') {
      userConfig.sqlite = Object.defineProperty({}, 'codeDbPath', { get() { throw secondary; } });
      assert.throws(() => resources.admitScope({ repoRoot, repoCacheRoot, userConfig, env, targets: [target] }), error => error === secondary);
      return 'handled diagnostic cannot settle its original resource';
    }
    resources.admitScope({ repoRoot, repoCacheRoot, userConfig, env, targets: [target] });
    throw primary;
  }), error => { failure = error; return Boolean(error.nativeDatabaseLifetime); });
  const owner = failure.nativeDatabaseLifetime;
  assert.equal(owner.handles, 0); assert.equal(owner.isSettled(), false);
  if (selected === 'marker-getter') {
    firstReady = true; secondReady = true;
    await assert.rejects(owner.recoverStorageMetadata());
    assert.equal(owner.isSettled(), false, 'unknown captured marker access cannot be replaced by later guessed readiness');
    await protectedAt(false);
  } else {
    await protectedAt(true); await assert.rejects(owner.recoverStorageMetadata());
    firstReady = true;
    if (selected !== 'captured-callback') {
      await assert.rejects(owner.recoverStorageMetadata(), 'settling the primary cannot erase an independent original observer');
      await protectedAt(true); secondReady = true;
    }
    assert.deepEqual(await owner.recoverStorageMetadata(), { settled: true, pending: false });
    assert.equal(owner.isSettled(), true); assert.equal(failure.cacheOwnershipReleased(), true); await protectedAt(false);
  }
} finally {
  firstReady = true; secondReady = true;
  if (failure && selected !== 'marker-getter' && !failure.nativeDatabaseLifetime.isSettled()) {
    await failure.nativeDatabaseLifetime.recoverStorageMetadata();
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`Native command original observations: ${selected}`);
