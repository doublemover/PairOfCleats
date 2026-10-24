import { errorGraphMatches } from '../../helpers/error-graph.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageSession, isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withStructuralBinary } from '../../../src/experimental/structural/execution.js';

// UNVALIDATED: actual structural/file/category owners; all child adapters inert.
const temporary = await makeTempDir('poc-structural-frozen-recovery-');
const sessions = [];
try {
  const toolingRoot = path.join(temporary, 'tooling'), generation = path.join(toolingRoot, 'generation');
  const state = path.join(temporary, 'state'), coordinationRoot = path.join(state, 'storage-access');
  const command = path.join(generation, 'inert-structural-command'), installId = 'a'.repeat(64);
  await fs.mkdir(generation, { recursive: true });
  await fs.writeFile(command, 'inert structural fixture; never executed');
  let latestSession;
  const dependencies = {
    getConfig: () => ({ dir: toolingRoot }),
    resolveTools: () => [{ id: 'ast-grep', managedInstallation: { command, installId, descriptorId: 'b'.repeat(64) } }],
    locate: () => ({ found: true, path: command }),
    retain: async () => {
      const session = acquireStorageSession({ roots: [generation], authorizedRoots: [toolingRoot, state], coordinationRoot,
        resourceId: `structural-fixture-${sessions.length}` });
      sessions.push(session); latestSession = session;
      const held = { command, args: [], root: generation, receipt: { installId },
        release: () => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) };
      Object.defineProperty(held, 'storageSession', { value: session });
      return held;
    },
    spawn: async (_command, args, options) => {
      options.onSpawn(); return { exitCode: 0, stdout: args.includes('--version') ? 'ast-grep 0.40.4' : '[]' };
    }
  };
  const inspect = () => inspectStorageAccess(toolingRoot, { coordinationRoot });
  for (const observation of ['known', 'missing', 'throwing']) {
    let confirmed = false, primary, failure;
    try {
      await withStructuralBinary('ast-grep', { repoRoot: temporary }, async () => {}, { ...dependencies,
        spawn: async (_command, _args, options) => {
          options.onSpawn();
          primary = Object.freeze(Object.assign(new Error(`frozen ${observation} child failure`), {
            code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', storageSession: latestSession, cacheOwnershipPending: true,
            ...(observation === 'known' ? { cacheOwnershipReleased: () => confirmed }
              : observation === 'throwing' ? { cacheOwnershipReleased: () => { throw new Error('unconfirmed'); } } : {}),
            result: { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } }
          }));
          assert.equal(isStorageSessionReleaseFailure(primary, latestSession), false);
          throw primary;
        } });
    } catch (error) { failure = error; }
    assert.equal(failure.cause, primary);
    assert.equal(failure.code, primary.code);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspect()).protected, true);
    assert.throws(() => failure.structuralInstallationSession.releaseAfterClosure(), error => errorGraphMatches(error, /remains pending/));
    confirmed = true;
    if (observation === 'known') {
      assert.equal(failure.structuralInstallationSession.releaseAfterClosure(), true);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal((await inspect()).protected, false);
      assert.equal(failure.structuralInstallationSession.releaseAfterClosure(), true);
    } else {
      assert.throws(() => failure.structuralInstallationSession.releaseAfterClosure(), error => errorGraphMatches(error, /remains pending/));
      // These injected children own no native resources. Fixture cleanup removes
      // exact metadata without claiming an unknown production resource closed.
      latestSession.releaseAfterSettlement({ resourceId: latestSession.resourceId, settled: true, pending: false });
      assert.equal(failure.cacheOwnershipReleased(), false);
    }
  }

  const originalRemove = fsSync.rmSync;
  let deny = true;
  try {
    fsSync.rmSync = (target, options) => {
      if (deny && String(target).startsWith(coordinationRoot + path.sep)) throw Object.assign(new Error('actual structural lease unlink denied'), { code: 'EACCES' });
      return originalRemove(target, options);
    };
    const primary = Object.freeze(Object.assign(new Error('frozen rule consumer failure'), { code: 'EIO' }));
    let failure;
    try { await withStructuralBinary('ast-grep', { repoRoot: temporary }, async () => { throw primary; }, dependencies); }
    catch (error) { failure = error; }
    assert.equal(failure.cause, primary);
    assert.equal(isStorageSessionReleaseFailure(failure.structuralReleaseError, latestSession), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspect()).protected, true);
    deny = false;
    assert.equal(failure.structuralInstallationSession.releaseAfterClosure(), true);
    assert.equal(failure.cacheOwnershipReleased(), true, 'the owned metadata failure cannot block its exact retry');
    assert.equal((await inspect()).protected, false);
  } finally { fsSync.rmSync = originalRemove; }

  let spawnedRules = 0;
  await assert.rejects(withStructuralBinary('ast-grep', { repoRoot: temporary }, scope => scope.run(['scan']), {
    ...dependencies, spawn: async (actual, args, options) => {
      assert.equal(actual, command); options.onSpawn();
      if (!args.includes('--version')) { spawnedRules++; await fs.writeFile(command, 'different bytes during a successful inert rule'); }
      return { exitCode: 0, stdout: args.includes('--version') ? 'ast-grep 0.40.4' : '[]' };
    }
  }), { code: 'ERR_STRUCTURAL_EXECUTABLE_CHANGED' });
  assert.equal(spawnedRules, 1);
  assert.equal((await inspect()).protected, false, 'known child closure releases ownership after terminal byte drift');

  let permit, rulePromise, scope, failure;
  const permitted = new Promise(resolve => { permit = resolve; });
  try {
    await withStructuralBinary('ast-grep', { repoRoot: temporary }, value => {
      scope = value; rulePromise = value.run(['scan']);
    }, { ...dependencies, spawn: async (_command, args, options) => {
      options.onSpawn(); if (!args.includes('--version')) await permitted;
      return { exitCode: 0, stdout: args.includes('--version') ? 'ast-grep 0.40.4' : '[]' };
    } });
  } catch (error) { failure = error; }
  assert.equal(failure.code, 'ERR_STRUCTURAL_PENDING');
  assert.equal((await inspect()).protected, true, 'an invocation started by this exact scope still owns its generation');
  assert.throws(() => failure.structuralInstallationSession.releaseAfterClosure(), error => errorGraphMatches(error, /remains pending/));
  permit(); await rulePromise;
  assert.equal(failure.structuralInstallationSession.releaseAfterClosure(), true);
  assert.equal(failure.cacheOwnershipReleased(), true);
  await assert.rejects(scope.run(['scan']), /scope has already closed/);
} finally {
  for (const session of sessions) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  await rmDirRecursive(temporary);
}
console.log('Structural execution preserves frozen failures and exact resource/metadata recovery.');
