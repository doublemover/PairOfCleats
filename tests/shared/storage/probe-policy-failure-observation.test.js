import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyStorageProbePolicy, planStorageProbePolicy } from '../../../src/shared/storage/probe-policy.js';
import { readStorageProbePolicy } from '../../../src/shared/storage/probe-policy-read.js';
import { isStorageObservationFailure } from '../../../src/shared/storage/failure-observation.js';
import { isProvisioningObservationFailure, observeProvisioningResource } from '../../../tools/tooling/provisioning-failure.js';
import { readPersistentCommandProbeCache, writePersistentCommandProbeCache,
  invalidatePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual disposable policy/cache readers, inert fs faults only.
// No executable, child, native binding, network or real user cache runs.
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const root = await makeTempDir('poc-policy-failure-observation-'), originalOpen = fs.openSync;
try {
  const home = path.join(root, 'home'), category = 'command-probes';
  const plan = await planStorageProbePolicy({ home, patch: { entryLimit: 2 } });
  const applied = await applyStorageProbePolicy(plan, { home, category, approvedPlanId: plan.planId });
  const locator = applied.file, receipt = applied.receiptFile;
  const locatorBytes = fs.readFileSync(locator), receiptBytes = fs.readFileSync(receipt);
  const fault = (file, failure) => {
    fs.openSync = (target, ...args) => {
      if (target === file) throw failure;
      return originalOpen(target, ...args);
    };
  };
  const consumers = [() => readStorageProbePolicy(home), () => readPersistentCommandProbeCache({}),
    () => writePersistentCommandProbeCache({}), () => invalidatePersistentCommandProbeCache({})];
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    for (const value of [undefined, null, false, 0, '']) {
      fault(locator, value);
      const report = readStorageProbePolicy(home);
      assert.equal(report.status, 'invalid'); assert.equal(report.error.code, 'ERR_STORAGE_POLICY');
      assert.equal(report.error.message, String(value)); assert.equal(report.mutationPerformed, false);
      assert.equal(readPersistentCommandProbeCache({}), null);
      assert.equal(writePersistentCommandProbeCache({}), false);
      assert.equal(invalidatePersistentCommandProbeCache({}), false);
    }
    for (const file of [locator, receipt]) {
      for (const marker of [undefined, false, true]) {
        for (const consume of consumers) {
          let settled = false, codeReads = 0;
          const primary = Object.defineProperties(new Error('original policy read owns native work'), {
            ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
            cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
            code: { get() { codeReads += 1; return 'ENOENT'; } }
          });
          fault(file, primary);
          const failure = caught(consume);
          assert.equal(failure.cause, primary); assert.equal(isStorageObservationFailure(failure), true);
          assert.equal(codeReads, 0, 'unknown original work cannot become a missing policy or repair report');
          primary.cacheOwnershipReleased = () => true;
          assert.equal(failure.cacheOwnershipReleased(), false);
          settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
          assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
        }
      }
    }
    for (const value of [undefined, null, false, 0, '']) {
      const primary = Object.freeze(Object.defineProperty(new Error('original code inspection'), 'code', {
        get() { throw value; }
      }));
      fault(locator, primary);
      const failure = caught(() => readPersistentCommandProbeCache({}));
      assert.equal(failure.cause, primary); assert.equal(failure.errors[1].cause, value);
      assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
      assert.equal(isStorageObservationFailure(failure), true, 'a diagnostic inspection error is not swallowed as an optional miss');
    }
    {
      let originalSettled = true, inspectionSettled = false, messageReads = 0;
      const inspection = Object.assign(new Error('independent policy message inspector'), {
        cacheOwnershipReleased() { assert.equal(this, inspection); return inspectionSettled; }
      });
      const primary = new Error('replace before freeze'); delete primary.stack;
      Object.freeze(Object.defineProperties(primary, {
        code: { value: 'EIO' },
        cacheOwnershipReleased: { value() { assert.equal(this, primary); return originalSettled; } },
        message: { get() { messageReads += 1; throw inspection; } }
      }));
      fault(locator, primary);
      const failure = caught(() => invalidatePersistentCommandProbeCache({}));
      assert.equal(failure.cause, primary); assert.equal(failure.errors[1], inspection);
      assert.equal(messageReads >= 1, true);
      inspection.cacheOwnershipReleased = () => true;
      assert.equal(failure.cacheOwnershipReleased(), false);
      inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
      originalSettled = false; assert.equal(failure.cacheOwnershipReleased(), false);
    }
    {
      let settled = true;
      const primary = Object.freeze(Object.defineProperties(new Error('diagnostic changes original pending state'), {
        cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; } },
        code: { get() { settled = false; return 'ENOENT'; } }
      }));
      fault(locator, primary);
      const failure = caught(() => readStorageProbePolicy(home));
      assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    }
    for (const key of ['cacheOwnershipPending', 'cacheOwnershipReleased']) {
      const primary = Object.freeze(Object.defineProperty(new Error('unreadable original policy resource marker'), key, {
        get() { throw null; }
      }));
      fault(locator, primary);
      const failure = caught(() => readStorageProbePolicy(home));
      assert.equal(failure.cacheOwnershipReleased(), false, 'unreadable originals remain unknown');
    }
    fault(locator, Object.freeze(Object.assign(new Error('known settled missing locator'), {
      code: 'ENOENT', cacheOwnershipReleased() { return true; }
    })));
    assert.equal(readStorageProbePolicy(home).status, 'missing');
    fault(receipt, Object.freeze(Object.assign(new Error('known settled missing receipt'), {
      code: 'ENOENT', cacheOwnershipReleased() { return true; }
    })));
    assert.equal(readStorageProbePolicy(home).status, 'invalid');
    fs.openSync = originalOpen;

    const command = path.join(root, 'inert-byte-consumer'); fs.writeFileSync(command, 'never executed');
    const base = { providerId: 'policy-observation-fixture', command, args: [], cwd: root,
      probeEnv: {}, toolingConfig: { cache: { dir: path.join(root, 'cache') } }, attempted: [{ ok: true }] };
    assert.equal(writePersistentCommandProbeCache(base), true);
    assert.equal(readPersistentCommandProbeCache(base)?.cached, true);
    const directory = path.join(root, 'cache', 'command-probes');
    const [name] = fs.readdirSync(directory), cacheFile = path.join(directory, name), cacheBytes = fs.readFileSync(cacheFile);
    for (const consume of [() => readPersistentCommandProbeCache(base), () => writePersistentCommandProbeCache(base),
      () => invalidatePersistentCommandProbeCache(base)]) {
      let policyReads = 0, settled = false;
      const primary = Object.freeze(Object.assign(new Error('original policy recheck retains work'), {
        cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      }));
      fs.openSync = (target, ...args) => {
        if (target === locator && ++policyReads === 2) throw primary;
        return originalOpen(target, ...args);
      };
      const failure = caught(consume);
      assert.equal(failure.cause, primary); assert.equal(policyReads, 2);
      assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
      assert.equal(failure.cacheOwnershipReleased(), true);
      fs.openSync = originalOpen;
      assert.deepEqual(fs.readFileSync(cacheFile), cacheBytes, 'failed policy recheck cannot proceed to a cache hit/write/unlink');
    }
  });
  fs.openSync = originalOpen;
  assert.deepEqual(fs.readFileSync(locator), locatorBytes); assert.deepEqual(fs.readFileSync(receipt), receiptBytes);
  assert.equal(readStorageProbePolicy(home).status, 'present');
  assert.equal(readStorageProbePolicy(path.join(root, 'missing-home')).status, 'missing');
  assert.equal(isStorageObservationFailure({ storageFailurePhase: 'storage-policy-read', cacheOwnershipPending: true }), false);
  assert.equal(isProvisioningObservationFailure({ provisioningFailurePhase: 'prerequisite-failure' }), false);
  {
    const primary = Object.freeze(Object.assign(new Error('shared provisioning adapter original'), { cacheOwnershipPending: true }));
    const observation = observeProvisioningResource(primary, { phase: 'adapter-compatibility' });
    const failure = caught(observation.requireSettled);
    assert.equal(failure.provisioningFailurePhase, 'adapter-compatibility');
    assert.equal(isProvisioningObservationFailure(failure), true); assert.equal(failure.cacheOwnershipReleased(), false);
  }
} finally { fs.openSync = originalOpen; await rmDirRecursive(root); }
console.log('probe-policy-failure-observation passed');
