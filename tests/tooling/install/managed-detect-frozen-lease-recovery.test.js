import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageSession, isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';

// UNVALIDATED: actual detector/file/category owners; inert child/installation adapter.
const temporary = await makeTempDir('poc-managed-detect-recovery-');
const heldSessions = [];
try {
  const home = path.join(temporary, 'home');
  const tooling = path.join(temporary, 'tooling');
  const generation = path.join(tooling, 'generation');
  const command = path.join(generation, 'inert-consumer');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await fs.mkdir(generation, { recursive: true });
  await fs.writeFile(command, 'inert fixture consumer; never executed');
  const installId = 'a'.repeat(64);
  const tool = { id: 'fixture-owned-detector', toolingRoot: tooling, detect: { cmd: command, args: ['--version'] },
    managedInstallation: { command, args: [], installId, descriptorId: 'b'.repeat(64) } };
  let denyRelease = false, childClosed = false, releaseCalls = 0, spawns = 0;
  let latestSession = null;
  const dependencies = { locate: () => ({ found: true, path: command, source: 'inert-fixture' }),
    validate: (_tool, _command, probe) => probe,
    retain: async () => {
      const session = acquireStorageSession({ roots: [generation], authorizedRoots: [tooling, path.join(home, 'state')],
        coordinationRoot, resourceId: `fixture-detector-${heldSessions.length}` });
      heldSessions.push(session);
      latestSession = session;
      const held = { command, args: [], root: generation, receipt: { installId, descriptorId: 'b'.repeat(64) }, release: () => {
        releaseCalls++;
        return denyRelease ? false : session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
      } };
      Object.defineProperty(held, 'storageSession', { value: session });
      return held;
    }, spawn: async (_command, _args, options) => { spawns++; options.onSpawn(); return { exitCode: 0, stdout: 'fixture version' }; } };
  const inspect = () => inspectStorageAccess(tooling, { coordinationRoot });

  const primary = Object.freeze(Object.assign(new Error('frozen child failure'), { code: 'EIO', cacheOwnershipPending: true,
    cacheOwnershipReleased: () => childClosed,
    result: { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } } }));
  let retained;
  try { await detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => { options.onSpawn(); throw primary; } }); }
  catch (error) { retained = error; }
  assert.equal(retained.cause, primary);
  assert.equal(retained.code, 'EIO');
  assert.equal(retained.cacheOwnershipReleased(), false);
  assert.equal((await inspect()).protected, true);
  assert.throws(() => retained.managedProbeSession.releaseAfterClosure(), /remains pending/,
    'observed child close cannot override the independent original pending observer');
  childClosed = true;
  denyRelease = true;
  assert.throws(() => retained.managedProbeSession.releaseAfterClosure(), error => error.cacheOwnershipPending === true
    && error.managedProbeReleaseError.code === 'ERR_MANAGED_PROBE_RELEASE');
  assert.equal(retained.cacheOwnershipReleased(), false, 'original closure confirmation does not settle failed metadata removal');
  assert.equal((await inspect()).protected, true);
  denyRelease = false;
  assert.equal(retained.managedProbeSession.releaseAfterClosure(), true);
  assert.equal(retained.cacheOwnershipReleased(), true);
  assert.equal((await inspect()).protected, false);
  const priorReleases = releaseCalls;
  assert.equal(retained.managedProbeSession.releaseAfterClosure(), true);
  assert.equal(releaseCalls, priorReleases, 'duplicate reconciliations do not release another owner');

  denyRelease = true;
  let metadataOnly;
  try { await detectToolOwned(tool, {}, dependencies); } catch (error) { metadataOnly = error; }
  assert.equal(metadataOnly.code, 'ERR_MANAGED_PROBE_RELEASE');
  assert.equal(metadataOnly.cacheOwnershipPending, true);
  assert.equal((await inspect()).protected, true);
  denyRelease = false;
  assert.equal(metadataOnly.managedProbeSession.releaseAfterClosure(), true, 'actual successful child closure permits exact metadata-only retry');
  assert.equal(metadataOnly.cacheOwnershipReleased(), true);

  const syncRemove = fsSync.rmSync;
  let denyUnlink = true;
  try {
    fsSync.rmSync = (target, options) => {
      if (denyUnlink && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('actual fixture lease unlink denied'), { code: 'EACCES' });
      return syncRemove(target, options);
    };
    let actualMetadata;
    try { await detectToolOwned(tool, {}, dependencies); } catch (error) { actualMetadata = error; }
    assert.equal(isStorageSessionReleaseFailure(actualMetadata.managedProbeReleaseError, latestSession), true,
      'the original actual session failure keeps its private producer identity under the detector wrapper');
    assert.equal(actualMetadata.cacheOwnershipReleased(), false);
    assert.equal((await inspect()).protected, true);
    denyUnlink = false;
    assert.equal(actualMetadata.managedProbeSession.releaseAfterClosure(), true,
      'the owned session observer must not block the held release that satisfies it');
    assert.equal(actualMetadata.cacheOwnershipReleased(), true);
    assert.equal((await inspect()).protected, false);
  } finally { fsSync.rmSync = syncRemove; }

  const operation = Object.freeze(Object.assign(new Error('frozen pre-launch byte read failure'), { code: 'EIO' }));
  denyRelease = true;
  let combined;
  try { await detectToolOwned(tool, {}, { ...dependencies, identify: () => { throw operation; } }); }
  catch (error) { combined = error; }
  assert.equal(combined.cause, operation);
  assert.equal(combined.managedProbeReleaseError.code, 'ERR_MANAGED_PROBE_RELEASE');
  assert.equal(combined.cacheOwnershipPending, true);
  denyRelease = false;
  assert.equal(combined.managedProbeSession.releaseAfterClosure(), true);
  assert.equal((await inspect()).protected, false);

  const beforeDrift = spawns;
  await assert.rejects(detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
    spawns++; options.onSpawn(); await fs.writeFile(command, 'changed bytes while the inert probe returned success');
    return { exitCode: 0, stdout: 'same displayed version' };
  } }), { code: 'ERR_TOOL_EXECUTABLE_CHANGED' }, 'post-probe identity drift is terminal and cannot become a missing-tool fallback');
  assert.equal(spawns, beforeDrift + 1);
  assert.equal((await inspect()).protected, false, 'confirmed child close still releases the retained generation after identity rejection');

  let unknown;
  let unconfirmed;
  try { await detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
    options.onSpawn();
    unknown = Object.freeze(Object.assign(new Error('unknown independent resource'), { cacheOwnershipPending: true,
      code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', storageSession: latestSession,
      result: { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } } }));
    assert.equal(isStorageSessionReleaseFailure(unknown, latestSession), false, 'same code/session properties cannot forge the producer capability');
    throw unknown;
  } }); }
  catch (error) { unconfirmed = error; }
  assert.equal(unconfirmed.cause, unknown);
  assert.throws(() => unconfirmed.managedProbeSession.releaseAfterClosure(), /remains pending/);
  assert.equal(unconfirmed.cacheOwnershipReleased(), false);
  assert.equal((await inspect()).protected, true);
} finally {
  // Every adapter resource in this fixture is inert. Clean only its exact
  // category metadata without asserting an unknown production resource closed.
  for (const session of heldSessions) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  await rmDirRecursive(temporary);
}
console.log('Managed detector preserves frozen failures and exact lease reconciliation.');
