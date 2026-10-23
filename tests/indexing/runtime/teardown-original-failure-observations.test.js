import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { acquireBuildRuntimeStorage } from '../../../src/index/build/runtime/storage.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual teardown and category owners with inert native surfaces.
// Original failures are captured before logging and later cleanup callbacks.
const hooks = registerHooks({ load(url, context, next) {
  const source = url.endsWith('/src/lang/tree-sitter.js') ? 'export const shutdownTreeSitterWorkerPool = async () => {};'
    : url.endsWith('/src/lang/python.js') ? 'export const shutdownPythonAstPool = async () => {};'
      : url.endsWith('/src/shared/subprocess/tracking-terminate.js')
        ? 'export const terminateTrackedSubprocesses = async options => ({...options,tracked:0,failures:0,killAudit:[]});'
        : url.endsWith('/src/integrations/tooling/providers/lsp/session-pool.js')
          ? 'export const drainLspSessionPool = async () => ({rejected:0,timedOut:false});' : null;
  return source === null ? next(url, context) : { format: 'module', source, shortCircuit: true };
} });
const rejected = async action => {
  let failed = false, result;
  try { await action(); } catch (error) { failed = true; result = error; }
  assert.equal(failed, true); return result;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const temporary = await makeTempDir('poc-runtime-original-observations-');
try {
  const { teardownRuntime } = await import('../../../src/integrations/core/build-index/runtime.js');
  for (const marker of [undefined, false, true]) {
    let settled = false, getterReads = 0, callbacks = 0, loggerCloses = 0;
    const primary = new Error('original worker cleanup observation');
    Object.defineProperty(primary, 'cacheOwnershipReleased', { configurable: true, get() {
      getterReads++;
      return function () { assert.equal(this, primary); callbacks++; return settled; };
    } });
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    const secondary = Object.freeze(new Error('independent embedding cleanup failure'));
    const failure = await rejected(() => teardownRuntime({
      log(line) {
        if (line.includes('runtime.worker-pools.destroy failed')) {
          assert.equal(Object.hasOwn(primary, 'runtimeFailurePhase'), false);
          assert.equal(Object.hasOwn(primary, 'storageContextInspectionErrors'), false,
            'capturing diagnostic context cannot rewrite the original rejected value');
          Object.defineProperty(primary, 'cacheOwnershipReleased', { value: () => true });
          primary.cacheOwnershipPending = false;
        }
      },
      workerPools: { destroy() { throw primary; } },
      closeEmbeddingRuntime() { throw secondary; }, closeLogger() { loggerCloses++; }
    }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(getterReads, 1, 'original observation is read before logging and never recaptured');
    assert.equal(loggerCloses, 1); assert.equal(failure.cacheOwnershipPending, true);
    assert.equal(failure.cacheOwnershipReleased(), false, 'later callback replacement cannot settle original work');
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.ok(callbacks >= 2);
  }

  // Diagnostic inspection is independent work, including when the original
  // failure has no pending flag or native observation of its own.
  {
    let settled = false, inspections = 0, observationReads = 0;
    const inspection = Object.defineProperties(new Error('original diagnostic inspection work'), {
      cacheOwnershipPending: { value: false },
      cacheOwnershipReleased: { configurable: true, get() {
        observationReads++;
        return function () { assert.equal(this, inspection); return settled; };
      } }
    });
    const primary = Object.freeze(Object.defineProperty({}, 'message', { get() { inspections++; throw inspection; } }));
    const secondary = Object.freeze(new Error('later cleanup still runs'));
    const failure = await rejected(() => teardownRuntime({ log() {},
      workerPools: { destroy() { throw primary; } }, closeLogger() { throw secondary; }
    }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, inspection), true);
    assert.equal(contains(failure, secondary), true); assert.equal(inspections, 1); assert.equal(observationReads, 1);
    Object.defineProperty(inspection, 'cacheOwnershipReleased', { value: () => true });
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('exact frozen cleanup failure'))]) {
    const single = await rejected(() => teardownRuntime({ log() {}, closeLogger() { throw primary; } }));
    assert.equal(single, primary, 'ordinary single rejection retains exact identity and falsey presence');
    const secondary = Object.freeze(new Error('independent second cleanup'));
    const failure = await rejected(() => teardownRuntime({ log() {},
      workerPools: { destroy() { throw primary; } }, closeLogger() { throw secondary; }
    }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(failure.cacheOwnershipPending, false); assert.equal(failure.cacheOwnershipReleased(), true);
  }

  {
    const primary = Object.assign(new Error('unknown native cleanup'), { cacheOwnershipPending: true });
    const failure = await rejected(() => teardownRuntime({ log() {}, workerPools: { destroy() { throw primary; } },
      closeLogger() { throw new Error('independent logger cleanup'); }
    }));
    primary.cacheOwnershipPending = false; primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'missing original observer cannot be added after capture');
  }

  // Original observations reach the existing category owner under their exact
  // rejected identity before its diagnostic projection can reread public fields.
  const repo = path.join(temporary, 'repo'); await fs.mkdir(repo);
  const home = path.join(temporary, 'home'), cache = path.join(temporary, 'cache');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const owner = await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
    () => acquireBuildRuntimeStorage(repo, { cache: { root: cache } }));
  let settled = false, fail = true, loggerCloses = 0, getterReads = 0, previousFailure = null;
  const primary = Object.defineProperty(new Error('actual category original native observation'), 'cacheOwnershipReleased', {
    configurable: true, get() { getterReads++; return function () { assert.equal(this, primary); return settled; }; }
  });
  const secondary = Object.freeze(new Error('independent retained category cleanup'));
  const runtime = { root: repo, indexRuntimeStorage: owner,
    log(line) {
      if (line.includes('runtime.worker-pools.destroy failed')) {
        Object.defineProperty(primary, 'cacheOwnershipReleased', { value: () => true });
      }
    },
    workerPools: { destroy() { if (fail) throw previousFailure || primary; } },
    closeLogger() { loggerCloses++; if (fail) throw secondary; }
  };
  try {
    const failure = await rejected(() => teardownRuntime(runtime));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(getterReads, 1); assert.equal(loggerCloses, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    previousFailure = failure;
    const repeated = await rejected(() => teardownRuntime(runtime));
    assert.equal(contains(repeated, failure), true); assert.equal(repeated.cacheOwnershipReleased(), false);
    fail = false;
    await assert.rejects(teardownRuntime(runtime), { code: 'ERR_INDEX_RUNTIME_STORAGE_PENDING' });
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    settled = true; await teardownRuntime(runtime);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(repeated.cacheOwnershipReleased(), true, 'the exact same owner failure cannot become a self-settlement cycle');
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
    assert.equal(getterReads, 1, 'category recovery uses original snapshots, not replacement diagnostics');
  } finally {
    // Only disposable inert fixture metadata; never a native settlement claim.
    owner.session.releaseAfterSettlement({ resourceId: owner.session.resourceId, settled: true, pending: false });
  }

  const siblingOwners = [];
  try {
    for (const name of ['first', 'second']) siblingOwners.push(await withTemporaryEnv({ PAIROFCLEATS_HOME: home },
      () => acquireBuildRuntimeStorage(repo, { cache: { root: path.join(temporary, name) } })));
    let firstFails = true, secondFails = true;
    const firstRuntime = { root: repo, log() {}, indexRuntimeStorage: siblingOwners[0],
      closeLogger() { if (firstFails) throw new Error('first category cleanup failure'); } };
    const sibling = await rejected(() => teardownRuntime(firstRuntime));
    const secondRuntime = { root: repo, log() {}, indexRuntimeStorage: siblingOwners[1],
      workerPools: { destroy() { if (secondFails) throw sibling; } },
      closeLogger() { if (secondFails) throw new Error('second category cleanup failure'); } };
    const outward = await rejected(() => teardownRuntime(secondRuntime));
    secondFails = false;
    await assert.rejects(teardownRuntime(secondRuntime), { code: 'ERR_INDEX_RUNTIME_STORAGE_PENDING' });
    assert.equal(outward.cacheOwnershipReleased(), false, 'a sibling category failure is an independent prerequisite');
    firstFails = false; await teardownRuntime(firstRuntime); await teardownRuntime(secondRuntime);
    assert.equal(sibling.cacheOwnershipReleased(), true); assert.equal(outward.cacheOwnershipReleased(), true);
  } finally {
    for (const sibling of siblingOwners) sibling.session.releaseAfterSettlement({ resourceId: sibling.session.resourceId, settled: true, pending: false });
  }
} finally { hooks.deregister(); await rmDirRecursive(temporary); }
console.log('Original runtime teardown observations and independent failure composition authored; execution deferred.');
