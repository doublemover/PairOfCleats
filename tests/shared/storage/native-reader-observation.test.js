import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireNativeReaderStorage, getPendingNativeStorageReaders } from '../../../src/shared/storage/native-reader.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual canonical admissions with inert native-open observations.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['ordinary-open', 'open-observer-error', 'open-original-capture', 'retained-observer-error', 'physical-observer-error'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'native-observation-'));
const repoRoot = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
await fs.mkdir(repoRoot);
const env = { ...process.env, PAIROFCLEATS_HOME: home }, userConfig = { cache: { root: cache } };
const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig), target = path.join(repoCacheRoot, 'index', 'code.db');
const coordinationRoot = path.join(home, 'state', 'storage-access');
let firstReady = false, secondReady = false, observerGets = 0, owner;
const secondary = Object.freeze(Object.assign(new Error('independently pending original observer'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return secondReady; }
}));
const original = Object.defineProperties(new Error('actual open resource failure'), {
  cacheOwnershipPending: { value: false },
  cacheOwnershipReleased: { get() {
    observerGets++;
    if (selected === 'open-original-capture' && observerGets > 1) return () => true;
    return function () { assert.equal(this, original); if (!firstReady && selected !== 'open-original-capture') throw secondary; return firstReady; };
  } }
});
const protectedRoot = async expected => {
  for (const root of [cache, path.join(cache, 'repos'), repoCacheRoot, target]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
  }
};
try {
  owner = acquireNativeReaderStorage(target, { repoRoot, userConfig, env }, () => {
    if (selected === 'physical-observer-error' && !firstReady) throw secondary;
    return true;
  });
  owner.start(); await protectedRoot(true);
  if (selected === 'ordinary-open') {
    owner.failedOpen(Object.freeze(Object.assign(new Error('no native opened'), { code: 'ENOENT' })));
    assert.equal(owner.isSettled(), true); await protectedRoot(false);
  } else {
    if (selected === 'physical-observer-error') assert.throws(() => owner.releaseAfterClosure());
    else if (selected === 'retained-observer-error') {
      owner.retainFailure(original); assert.throws(() => owner.releaseAfterClosure());
    } else assert.throws(() => owner.failedOpen(original));
    await protectedRoot(true); assert.equal(owner.isSettled(), false);
    if (selected === 'open-original-capture') assert.throws(() => owner.releaseAfterClosure(),
      'a later getter cannot replace the callback captured at failed-open admission');
    firstReady = true;
    if (selected !== 'open-original-capture') {
      assert.throws(() => owner.releaseAfterClosure(), 'a settled primary cannot erase independent observer-owned work');
      await protectedRoot(true); secondReady = true;
    }
    assert.equal(owner.releaseAfterClosure(), true); await protectedRoot(false); assert.equal(owner.isSettled(), true);
  }
  assert.equal(getPendingNativeStorageReaders().includes(owner), false);
} finally {
  firstReady = true; secondReady = true; owner?.releaseAfterClosure();
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`Native reader original observation retention: ${selected}`);
