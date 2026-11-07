import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual category sessions and byte identity, inert probe adapter.
// No real child, IPC, installer, native binding, model or network execution.
const root = await makeTempDir('poc-managed-detect-diagnostic-');
const heldSessions = [];
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const closedTermination = Object.freeze({ closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false });
try {
  const tooling = path.join(root, 'tooling'), generation = path.join(tooling, 'generation');
  const state = path.join(root, 'state'), coordinationRoot = path.join(state, 'storage-access');
  const command = path.join(generation, 'inert-command');
  await fs.mkdir(generation, { recursive: true }); await fs.writeFile(command, 'actual inert tool bytes, never executed');
  const installId = 'a'.repeat(64), descriptorId = 'b'.repeat(64);
  const tool = { id: 'fixture-diagnostic-owner', toolingRoot: tooling, detect: { cmd: command, args: ['--version'] },
    managedInstallation: { command, args: [], installId, descriptorId } };
  let latestHeld, spawns = 0, releaseCalls = 0, denyRelease = false, releaseFailure;
  const dependencies = {
    locate: () => ({ found: true, path: command, source: 'inert-fixture' }), validate: (_tool, _command, probe) => probe,
    retain: async () => {
      const storageSession = acquireStorageSession({ roots: [generation], authorizedRoots: [tooling, state],
        coordinationRoot, resourceId: `diagnostic-owner-${heldSessions.length}` });
      heldSessions.push(storageSession);
      const held = { command, args: [], root: generation, receipt: { installId, descriptorId }, release() {
        assert.equal(this, held); releaseCalls += 1;
        if (denyRelease) throw releaseFailure;
        return storageSession.releaseAfterSettlement({ resourceId: storageSession.resourceId, settled: true, pending: false });
      } };
      Object.defineProperty(held, 'storageSession', { value: storageSession }); latestHeld = held; return held;
    }, spawn: async (_command, _args, options) => { spawns += 1; options.onSpawn(); return { exitCode: 0, stdout: 'fixture version' }; }
  };
  const inspect = () => inspectStorageAccess(tooling, { coordinationRoot });
  {
    let replacementCalls = 0;
    const detected = await detectToolOwned(tool, {}, { ...dependencies, spawn: async (...args) => {
      latestHeld.release = () => { replacementCalls += 1; return true; };
      return dependencies.spawn(...args);
    } });
    assert.equal(detected.found, true); assert.equal(replacementCalls, 0); assert.equal((await inspect()).protected, false);
  }
  for (const value of [undefined, null, false, 0, '']) {
    denyRelease = true; releaseFailure = 0;
    const beforeSpawns = spawns;
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, identify: () => { throw value; } }));
    assert.equal(failure.cause.cause, value); assert.equal(failure.managedProbeReleaseError.cause, 0);
    assert.equal((await inspect()).protected, true); assert.equal(spawns, beforeSpawns);
    denyRelease = false; assert.equal(failure.managedProbeSession.releaseAfterClosure(), true);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal((await inspect()).protected, false);
  }
  for (const marker of [undefined, false, true]) {
    let originalSettled = false, metadataReads = 0;
    const result = Object.defineProperties({ exitCode: 0,
      ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, result); return originalSettled; }
    }, { stdout: { get() { metadataReads += 1; return 'fixture version'; } } });
    const beforeSpawns = spawns;
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
      spawns += 1; options.onSpawn(); return result;
    } }));
    assert.equal(contains(failure, result), true); assert.equal(metadataReads, 0); assert.equal((await inspect()).protected, true);
    result.cacheOwnershipReleased = () => true;
    assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    assert.equal(metadataReads, 0); originalSettled = true;
    assert.equal(failure.managedProbeSession.releaseAfterClosure(), true);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal((await inspect()).protected, false);
    assert.equal(metadataReads, 0); assert.equal(spawns, beforeSpawns + 1, 'release-only reconciliation cannot replay probe verification');
  }
  for (const value of [undefined, null, false, 0, '']) {
    const primary = Object.freeze(Object.defineProperties(new Error('original diagnostic code inspection'), {
      code: { get() { throw value; } }, result: { value: { termination: closedTermination } }
    }));
    const beforeSpawns = spawns;
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
      spawns += 1; options.onSpawn(); throw primary;
    } }));
    assert.equal(contains(failure, primary), true); assert.equal(failure.managedProbeInspectionError.cause, value);
    assert.equal(Object.hasOwn(failure.managedProbeInspectionError, 'cause'), true);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal((await inspect()).protected, false);
    assert.equal(spawns, beforeSpawns + 1, 'classification getter failure is terminal, never another probe candidate');
  }
  {
    let firstReady = false, secondReady = false, messages = 0;
    const first = Object.assign(new Error('first message inspection native owner'), {
      cacheOwnershipReleased() { assert.equal(this, first); return firstReady; }
    });
    const second = Object.assign(new Error('fallback message inspection native owner'), {
      cacheOwnershipReleased() { assert.equal(this, second); return secondReady; }
    });
    const primary = new Error('frozen message inspector'); delete primary.stack;
    Object.defineProperties(primary, { code: { value: 'EPRIMARY', enumerable: true }, result: { value: { termination: closedTermination } },
      message: { get() { messages += 1; throw messages === 1 ? first : second; } } });
    Object.freeze(primary);
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
      spawns += 1; options.onSpawn(); throw primary;
    } }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, first), true); assert.equal(contains(failure, second), true);
    assert.equal(failure.code, 'EPRIMARY'); assert.equal((await inspect()).protected, true);
    first.cacheOwnershipReleased = () => true; second.cacheOwnershipReleased = () => true;
    assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    firstReady = true; assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    secondReady = true; assert.equal(failure.managedProbeSession.releaseAfterClosure(), true);
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal((await inspect()).protected, false);
    assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
  }
  {
    let ready = false;
    const primary = function originalFunctionFailure() {};
    Object.assign(primary, { result: { termination: closedTermination },
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; } });
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
      spawns += 1; options.onSpawn(); throw primary;
    } }));
    assert.equal(contains(failure, primary), true); assert.equal((await inspect()).protected, true);
    primary.cacheOwnershipReleased = () => true;
    assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    ready = true; assert.equal(failure.managedProbeSession.releaseAfterClosure(), true); assert.equal((await inspect()).protected, false);
  }
  {
    let attempts = 0, originalHeld, unknownResult;
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, retain: async () => {
      originalHeld = await dependencies.retain();
      originalHeld.release = function () {
        assert.equal(this, originalHeld); attempts += 1; unknownResult = Promise.resolve(true); return unknownResult;
      };
      return originalHeld;
    } }));
    assert.equal(contains(failure, unknownResult), true); assert.equal((await inspect()).protected, true);
    assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    assert.equal(attempts, 1, 'unknown synchronous release evidence cannot authorize another owner invocation');
  }
  {
    let ready = false;
    const inspection = Object.freeze(Object.assign(new Error('unknown original observer inspection owner'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return ready; }
    }));
    const primary = Object.freeze(Object.defineProperties(new Error('unreadable original marker'), {
      result: { value: { termination: closedTermination } }, cacheOwnershipPending: { get() { throw inspection; } }
    }));
    const failure = await rejected(() => detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
      spawns += 1; options.onSpawn(); throw primary;
    } }));
    assert.equal(contains(failure, inspection), true); ready = true;
    assert.throws(() => failure.managedProbeSession.releaseAfterClosure(), /remains pending/);
    assert.equal((await inspect()).protected, true, 'unreadable original evidence stays unknown after secondary settlement');
  }
  assert.ok(releaseCalls > 0);
} finally {
  // Fixture adapters are inert. Exact metadata disposal is not a claim that an
  // unknown production resource or deliberately unreadable predicate settled.
  for (const session of heldSessions) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  await rmDirRecursive(root);
}
console.log('Actual managed detector retains original diagnostics and category lifetime.');
