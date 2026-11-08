import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { runManagedChildWithStorage } from '../../../src/shared/storage/managed-child-session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('poc-managed-child-admission-');
try {
  const layout = resolveStorageLayout({ home: path.join(temporary, 'home'), env: {} });
  const coordinationRoot = path.join(temporary, 'state', 'storage-access');
  const artifactRoot = path.join(temporary, 'tool-assets');
  await fs.mkdir(artifactRoot);
  const plan = planManagedChildStorage({ layout, baseEnv: {}, command: 'npm', managed: true,
    toolId: 'fixture', toolIdentity: 'fixture-v1', runId: 'pending-run' });
  let started = false;
  await assert.rejects(runManagedChildWithStorage({ plan, authorizedRoots: [temporary], coordinationRoot,
    admission: { writes: [{ root: artifactRoot, requiredBytes: 100, minimumFreeBytes: 10,
      freeSpaceOwner: async () => ({ complete: true, availableBytes: 50, observedPath: artifactRoot }) }] } },
  async () => { started = true; }, { settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false }) }),
  error => error.reason === 'minimum-free-space-or-pending-reservations');
  assert.equal(started, false, 'budget rejection precedes preparation and real child start');
  await assert.rejects(fs.lstat(plan.scratch), { code: 'ENOENT' });
  const primary = Object.assign(new Error('real child ownership still pending'), { cacheOwnershipPending: true });
  let error;
  try {
    await runManagedChildWithStorage({ plan, authorizedRoots: [temporary], coordinationRoot,
      admission: { writes: [{ root: artifactRoot, requiredBytes: 20,
        freeSpaceOwner: async () => ({ complete: true, availableBytes: 100, observedPath: artifactRoot }) }] } },
    async () => { throw primary; }, { settlement: ({ resourceId }) => ({ resourceId, settled: false, pending: true }) });
  } catch (caught) { error = caught; }
  assert.equal(error, primary);
  assert.equal(error.storageWriteReservations.length, 1);
  assert.equal((await inspectStorageAccess(artifactRoot, { coordinationRoot })).protected, true);
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 1);
  const receipt = { resourceId: error.storageSession.resourceId, settled: true, pending: false };
  await error.storageWriteReservations[0].releaseAfterSettlement(receipt);
  error.storageSession.releaseAfterSettlement(receipt);
  assert.equal((await inspectStorageAccess(artifactRoot, { coordinationRoot })).protected, false);
} finally { await rmDirRecursive(temporary); }
console.log('managed child admission lifetime passed');
