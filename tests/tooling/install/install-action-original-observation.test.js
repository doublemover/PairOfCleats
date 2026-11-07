import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runInstallWithStorageAdmission } from '../../../tools/tooling/install-storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/install-action-original-observation/')[1];
assert.ok(['function-failure', 'returned-pending-result', 'independent-inspection', 'revoked-during-reservation-read'].includes(mode));
const temporary = await makeTempDir('poc-install-action-observation-'), toolingRoot = path.join(temporary, 'tools'), home = path.join(temporary, 'home');
const coordinationRoot = path.join(home, 'state', 'storage-access'), open = fs.open;
let ready = false, independentReady = false, coerced = 0, observedInspection = false, activeAction = false, intercepted = false;
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    const independent = Object.freeze(Object.assign(new Error('independent original action inspection'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => independentReady
    }));
    const original = mode === 'function-failure' ? function originalInstallerFailure() {} : new Error('original bounded install action');
    Object.defineProperties(original, { code: { value: 'EORIGINAL_ACTION' }, cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value() {
        if (mode === 'independent-inspection' && !observedInspection) { observedInspection = true; throw independent; }
        return ready;
      } }, [Symbol.toPrimitive]: { value() { coerced++; throw new Error('original function must not be coerced'); } } });
    Object.freeze(original);
    if (mode === 'revoked-during-reservation-read') {
      ready = true;
      fs.open = async (filename, ...args) => {
        const handle = await open(filename, ...args);
        if (activeAction && !intercepted && typeof filename === 'string' && path.basename(path.dirname(filename)) === 'write-reservations') {
          intercepted = true; const close = handle.close;
          handle.close = async function () { assert.equal(this, handle); const result = await close.call(handle); ready = false; return result; };
        }
        return handle;
      };
    }
    let failure;
    try {
      await runInstallWithStorageAdmission({ toolingRoot, storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1 }] } }, async () => {
        activeAction = true; if (mode === 'returned-pending-result') return original; throw original;
      });
    } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true); assert.equal(coerced, 0);
    if (mode === 'independent-inspection') assert.equal(errorGraphIncludes(failure, independent), true);
    if (mode === 'revoked-during-reservation-read') assert.equal(intercepted, true);
    const recovery = failure.installActionSession; assert.ok(recovery);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    await assert.rejects(recovery.releaseAfterClosure());
    ready = true;
    if (mode === 'independent-inspection') {
      await assert.rejects(recovery.releaseAfterClosure()); independentReady = true;
    }
    assert.deepEqual(await Promise.all([recovery.releaseAfterClosure(), recovery.releaseAfterClosure()]), [true, true]);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(coerced, 0);
    const reservations = await fs.readdir(path.join(coordinationRoot, 'write-reservations'));
    assert.equal(reservations.length, 0); await assert.rejects(fs.stat(path.join(coordinationRoot, 'write-admission.lock')), { code: 'ENOENT' });
  });
} finally { ready = true; independentReady = true; fs.open = open; await rmDirRecursive(temporary, { retries: 0 }); }
console.log('Original install action functions, returned results and independent inspections guard original outer reservations/leases.');
