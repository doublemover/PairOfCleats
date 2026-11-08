import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock, releaseFileLockOrThrow } from '../../../src/shared/locks/file-lock.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual disposable lock admission/release and inert release-result controls.
// Authored only; execution and Windows qualification are deferred.
const failureOf = work => work.then(() => assert.fail('expected exact lock/worker rejection'),
  error => ({ rejected: true, error }));
const temporary = await makeTempDir('poc-lock-falsey-failures-');
const remove = fs.rm;
try {
  for (const [index, value] of [undefined, null, false, 0, ''].entries()) {
    const lockPath = path.join(temporary, `worker-${index}.lock`);
    const failure = await failureOf(withFileLock({ lockPath, waitMs: 0 }, async () => { throw value; }));
    assert.equal(failure.rejected, true);
    assert.equal(failure.error, value, 'falsey worker rejection cannot become success');
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' }, 'ordinary release still completes before rejection');

    const options = Object.freeze({ exactRelease: index });
    let releases = 0;
    const refused = await failureOf(releaseFileLockOrThrow({ lockPath, async release(received) {
      assert.equal(received, options); releases++; throw value;
    } }, { workerError: value, releaseOptions: options }));
    assert.equal(releases, 1);
    assert.equal(refused.error.code, 'ERR_FILE_LOCK_RELEASE_FAILED');
    assert.equal(Object.hasOwn(refused.error, 'cause'), true);
    assert.equal(refused.error.cause, value, 'falsey release rejection remains its exact cause');
    assert.equal(Object.hasOwn(refused.error, 'workerError'), true);
    assert.equal(refused.error.workerError, value, 'including an explicitly supplied undefined worker failure');

    const deniedPath = path.join(temporary, `release-${index}.lock`);
    const unlinkFailure = Object.freeze(Object.assign(new Error('frozen exact metadata unlink failure'), { code: 'EACCES' }));
    fs.rm = async (target, ...args) => { if (target === deniedPath) throw unlinkFailure; return remove(target, ...args); };
    let combined;
    try { combined = await failureOf(withFileLock({ lockPath: deniedPath, waitMs: 0 }, async () => { throw value; })); }
    finally { fs.rm = remove; }
    assert.equal(combined.error.cause, unlinkFailure);
    assert.equal(combined.error.causeCode, 'EACCES');
    assert.equal(combined.error.workerError, value);
    assert.equal((await fs.stat(deniedPath)).isFile(), true, 'unconfirmed original metadata is retained');
    await remove(deniedPath);

    const result = await withFileLock({ lockPath, waitMs: 0 }, async () => value);
    assert.equal(result, value, 'fulfilled falsey work retains its original success contract');
  }
  const unconfirmed = await failureOf(releaseFileLockOrThrow({ lockPath: 'inert-owned-lock', release: async () => false }));
  assert.equal(unconfirmed.error.releaseResult, false);
  assert.equal(unconfirmed.error.causeCode, '');
  assert.equal(unconfirmed.error.workerError, null);
  assert.equal(Object.hasOwn(unconfirmed.error, 'cause'), false, 'a false result does not fabricate a thrown cause');
  assert.equal(await releaseFileLockOrThrow({ release: async () => true }), true);
} finally { fs.rm = remove; await rmDirRecursive(temporary); }
console.log('Exact falsey worker and release failure controls authored; execution deferred.');
