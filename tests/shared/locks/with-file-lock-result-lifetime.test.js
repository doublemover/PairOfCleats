import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock, isFileLockPublicationPending, removeLockFileSyncIfOwned } from '../../../src/shared/locks/file-lock.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual lock publication/release and original returned observers.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['pending', 'unmarked', 'observer-child', 'replacement', 'settled', 'plain-values', 'release-getter'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'file-lock-result-'));
try {
  const file = path.join(root, 'publication.lock');
  if (selected === 'plain-values') {
    for (const value of [undefined, null, false, 0, '', Object.freeze({ answer: 42 })]) {
      assert.equal(await withFileLock({ lockPath: file }, () => value), value);
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
  } else {
    let ready = selected === 'settled' || selected === 'release-getter', childReady = false, inspectChild = selected === 'observer-child';
    let held, workers = 0, getterCalls = 0;
    const child = Object.freeze(Object.assign(new Error('independent result observer owns work'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, child); return childReady; }
    }));
    const original = function () {
      assert.equal(this, result);
      if (inspectChild) { inspectChild = false; throw child; }
      return ready;
    };
    let reported = original;
    const result = Object.freeze(Object.defineProperties({ answer: 42 }, {
      ...(selected !== 'unmarked' ? { cacheOwnershipPending: { value: true } } : {}),
      cacheOwnershipReleased: { get() { getterCalls++; return reported; } }
    }));
    const operation = withFileLock({ lockPath: file }, lock => {
      held = lock; workers++;
      if (selected === 'release-getter') {
        const release = lock.release;
        Object.defineProperty(lock, 'release', { get() { ready = false; reported = () => true; return release; } });
      }
      return result;
    });
    if (selected === 'settled') {
      assert.equal(await operation, result);
      assert.equal(workers, 1); assert.ok(getterCalls >= 1);
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    } else {
      let failure;
      await assert.rejects(operation, error => { failure = error; return true; });
      assert.ok(errorGraphIncludes(failure.workerError, result));
      if (selected === 'observer-child') assert.ok(errorGraphIncludes(failure.workerError, child));
      assert.equal(workers, 1); assert.ok(getterCalls >= 1);
      const capturedReads = getterCalls;
      assert.equal(isFileLockPublicationPending(file), true);
      assert.equal((await fs.stat(file)).isFile(), true);
      assert.equal(await removeLockFileIfOwned(file, held.payload, { force: true }), false);
      assert.equal(removeLockFileSyncIfOwned(file, held.payload, { force: true }), false);
      const session = failure.fileLockPublicationSession;
      assert.ok(session);
      if (selected === 'replacement') {
        reported = () => true;
        await assert.rejects(session.releaseAfterClose());
        assert.equal((await fs.stat(file)).isFile(), true);
      }
      ready = true;
      if (selected === 'observer-child') {
        await assert.rejects(session.releaseAfterClose());
        assert.equal((await fs.stat(file)).isFile(), true);
      }
      childReady = true;
      const receipt = await session.releaseAfterClose();
      assert.equal(receipt.settled, true); assert.equal(receipt.pending, false);
      assert.equal(workers, 1); assert.equal(getterCalls, capturedReads, 'metadata recovery uses original captured observers');
      assert.equal(isFileLockPublicationPending(file), false);
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`withFileLock original result ${selected} passed`);
