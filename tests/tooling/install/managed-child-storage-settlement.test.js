#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bindDeclaredInstallAdmission, resolveDeclaredInstallAdmission, runToolInstallChild } from '../../../tools/tooling/install-execution.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'managed-child-storage-settlement');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const layout = resolveStorageLayout({ home: root, env: {} });
  const plan = planManagedChildStorage({ baseEnv: {}, layout, family: 'npm', managed: true,
    toolId: 'fixture', toolIdentity: 'fixture-pinned-identity', runId: 'fixture-run' });
  let missingEstimateSpawns = 0;
  const deferred = await runToolInstallChild({ command: 'fixture', args: [], options: {}, storagePlan: plan, layout,
    spawn: async () => { missingEstimateSpawns++; } });
  assert.equal(deferred.error.code, 'ERR_INSTALL_STORAGE_ESTIMATE_REQUIRED');
  assert.equal(missingEstimateSpawns, 0);
  await assert.rejects(fs.stat(plan.scratch), { code: 'ENOENT' });
  await assert.rejects(runToolInstallChild({ command: 'fixture', args: [], options: { cwd: root }, storagePlan: plan, layout,
    spawn: async () => { missingEstimateSpawns++; } }), { code: 'ERR_INSTALL_STORAGE_CWD_CHANGED' });
  assert.equal(missingEstimateSpawns, 0, 'a cwd change is rejected before admission, preparation or child execution');
  await assert.rejects(fs.stat(plan.scratch), { code: 'ENOENT' });
  assert.equal(resolveDeclaredInstallAdmission({ managedDescriptor: { archive: { bytes: 1024 } } }).writes, null,
    'archive length cannot stand in for expanded/build allocation');
  const declared = resolveDeclaredInstallAdmission({ storageEstimate: { complete: true, writes: [
    { destination: 'artifacts', requiredBytes: 1024 }, { environmentKey: 'npm_config_cache', requiredBytes: 256 },
    { destination: 'scratch', requiredBytes: 64 }
  ] } });
  const admission = bindDeclaredInstallAdmission(declared, { storagePlan: plan, artifactRoot: layout.descriptors.tooling.path });
  assert.ok(admission.writes.some(write => write.root === layout.descriptors.tooling.path && write.requiredBytes === 1024));
  assert.equal(bindDeclaredInstallAdmission(resolveDeclaredInstallAdmission({ storageEstimate: { complete: true,
    writes: [{ destination: 'scratch', requiredBytes: 64 }] } }), { storagePlan: plan, artifactRoot: layout.descriptors.tooling.path }), null,
  'secondary scratch coverage cannot omit the actual installed artifact root');
  assert.throws(() => resolveDeclaredInstallAdmission({ storageEstimate: { complete: true,
    writes: [{ destination: 'artifacts', requiredBytes: 1, minimumFreeBytes: -1 }] } }), /nonnegative/);
  const normal = await runToolInstallChild({ command: 'fixture', args: [], options: {}, storagePlan: plan, layout,
    admission, artifactRoot: layout.descriptors.tooling.path,
    spawn: async (_command, _args, options) => { options.onSpawn(); return { exitCode: 0, signal: null, stdout: '', stderr: '' }; } });
  assert.equal(normal.settlement.settled, true);
  const next = planManagedChildStorage({ baseEnv: {}, layout, family: 'npm', managed: true,
    toolId: 'fixture', toolIdentity: 'fixture-pinned-identity', runId: 'pending-run' });
  let pending;
  try {
    await runToolInstallChild({ command: 'fixture', args: [], options: {}, storagePlan: next, layout,
      admission: bindDeclaredInstallAdmission(declared, { storagePlan: next, artifactRoot: layout.descriptors.tooling.path }),
      artifactRoot: layout.descriptors.tooling.path,
      spawn: async (_command, _args, options) => {
        options.onSpawn();
        throw Object.assign(new Error('fixture teardown pending'), { cacheOwnershipPending: true,
          result: { termination: { closeObserved: false, treeCleanupSettled: true, treeCleanupFailed: false } } });
      } });
  } catch (error) { pending = error; }
  assert.equal(pending.cacheOwnershipPending, true);
  const coordinationRoot = path.join(layout.descriptors.state.path, 'storage-access');
  assert.equal((await inspectStorageAccess(next.scratch, { coordinationRoot })).protected, true);
  pending.storageSession.releaseAfterSettlement({ resourceId: pending.storageSession.resourceId, settled: true, pending: false });
  assert.equal((await inspectStorageAccess(next.scratch, { coordinationRoot })).protected, false);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Installer storage leases follow exact child settlement.');
