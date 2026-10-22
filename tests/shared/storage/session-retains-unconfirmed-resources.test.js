import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageSession, runWithStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('poc-storage-session-');
try {
  const root = path.join(temporary, 'assets', 'model');
  const coordinationRoot = path.join(temporary, 'state', 'access');
  const input = { roots: [root], coordinationRoot, authorizedRoots: [temporary], resourceId: 'fixture-model-session' };
  const session = acquireStorageSession(input);
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  assert.throws(() => session.releaseAfterSettlement({ resourceId: 'old-session', settled: true }), /exact resource/);
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('live model cannot be collected'), { coordinationRoot })).protected, true);
  session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
  let pendingError;
  const primary = Object.assign(new Error('fixture child deadline'), { cacheOwnershipPending: true });
  try {
    await runWithStorageSession({ ...input, resourceId: 'fixture-pending-child' }, async () => { throw primary; }, {
      settlement: ({ resourceId }) => ({ resourceId, settled: false, pending: true })
    });
  } catch (error) { pendingError = error; }
  assert.equal(pendingError, primary, 'primary failure survives incomplete cleanup');
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  pendingError.storageSession.releaseAfterSettlement({ resourceId: 'fixture-pending-child', settled: true, pending: false });
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
  let close;
  const completion = new Promise(resolve => { close = resolve; });
  const running = runWithStorageSession({ ...input, resourceId: 'fixture-delayed-close' }, async () => completion, {
    settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false })
  });
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true, 'session lease spans pending native/child completion');
  close('closed');
  assert.equal((await running).value, 'closed');
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
  assert.equal((await fs.readdir(temporary)).includes('state'), true);
} finally { await rmDirRecursive(temporary); }
console.log('storage sessions retain unconfirmed resources passed');
