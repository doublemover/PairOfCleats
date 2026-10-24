// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { runManagedChildWithStorage } from '../../../src/shared/storage/managed-child-session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const root = await makeTempDir('managed-child-admission-recovery-');
const originalRm = fs.rm;
let pending;
try {
  const layout = resolveStorageLayout({ home: path.join(root, 'home'), env: {} });
  const coordinationRoot = path.join(root, 'state', 'storage-access');
  const lockPath = path.join(coordinationRoot, 'write-admission.lock');
  const artifactRoots = [path.join(root, 'first-assets'), path.join(root, 'second-assets')];
  for (const artifact of artifactRoots) await fs.mkdir(artifact);
  const plan = planManagedChildStorage({ layout, managed: true, command: 'npm', baseEnv: {},
    toolId: 'fixture', toolIdentity: 'fixture-v1', runId: 'admission-creation-pending' });
  let releases = 0, denyRelease = true;
  fs.rm = async (target, ...args) => {
    if (target === lockPath && ++releases >= 2 && denyRelease) {
      throw Object.assign(new Error('inert second admission coordinator release failed'), { code: 'EACCES' });
    }
    return originalRm(target, ...args);
  };
  let children = 0, settlements = 0;
  await assert.rejects(runManagedChildWithStorage({ plan, authorizedRoots: [root], coordinationRoot,
    admission: { writes: artifactRoots.map(artifact => ({ root: artifact, requiredBytes: 10,
      freeSpaceOwner: async () => ({ complete: true, availableBytes: 1024, observedPath: artifact }) })) } },
  async () => { children++; }, { settlement: ({ resourceId }) => { settlements++; return { resourceId, settled: true, pending: false }; } }),
  error => { pending = error; return error.cacheOwnershipPending === true && Boolean(error.managedChildAdmissionSession); });
  assert.equal(children, 0);
  assert.equal(settlements, 0, 'child no-start cannot ask a child owner to settle an uncertain admission');
  assert.equal(pending.storageWriteReservations.length, 2, 'prior successful and failed-return sealed reservations both remain reachable');
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 2);
  await assert.rejects(fs.stat(plan.scratch), { code: 'ENOENT' });
  for (const artifact of artifactRoots) assert.equal((await inspectStorageAccess(artifact, { coordinationRoot })).protected, true);
  const held = pending.managedChildAdmissionSession;
  await assert.rejects(held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true }), /explicit pending:false/);
  await assert.rejects(held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: true }), /explicit pending:false/);
  await assert.rejects(held.releaseAfterSettlement({ resourceId: 'another-resource', settled: true, pending: false }), /exact resource/);
  const receipt = { resourceId: held.resourceId, settled: true, pending: false };
  await assert.rejects(held.releaseAfterSettlement(receipt), { code: 'ERR_FILE_LOCK_RELEASE_FAILED' });
  for (const artifact of artifactRoots) assert.equal((await inspectStorageAccess(artifact, { coordinationRoot })).protected, true);
  denyRelease = false;
  assert.deepEqual(await Promise.all([held.releaseAfterSettlement(receipt), held.releaseAfterSettlement(receipt)]), [true, true]);
  for (const artifact of artifactRoots) assert.equal((await inspectStorageAccess(artifact, { coordinationRoot })).protected, false);
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 0);
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });

  const externalCache = path.join(root, 'explicit-user-cache');
  const external = planManagedChildStorage({ layout, managed: false, command: 'npm',
    baseEnv: { npm_config_cache: externalCache }, toolId: 'fixture-external', toolIdentity: 'fixture-v1', runId: 'external-run' });
  const beforeExternal = await fs.readdir(root, { recursive: true });
  const result = await runManagedChildWithStorage({ plan: external, authorizedRoots: [root], coordinationRoot },
    async ({ env, storage }) => {
      assert.equal(env.npm_config_cache, externalCache);
      assert.equal(storage.external, true);
      return 'external-owner-result';
    }, { settlement: () => assert.fail('external routing does not acquire managed child settlement authority') });
  assert.equal(result.resourceId, null);
  assert.equal(result.value, 'external-owner-result');
  assert.deepEqual(await fs.readdir(root, { recursive: true }), beforeExternal);
} finally {
  fs.rm = originalRm;
  if (pending?.managedChildAdmissionSession) await pending.managedChildAdmissionSession.releaseAfterSettlement({
    resourceId: pending.managedChildAdmissionSession.resourceId, settled: true, pending: false });
  await rmDirRecursive(root);
}
console.log('Managed child no-start preserves acquisition-time reservation and exact admission recovery owners.');
