import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { isStorageObservationFailure } from '../../../src/shared/storage/failure-observation.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual disposable cleanup plans, inert pre-open failures only.
// This fixture does not claim coordinator/native close lifetime acceptance.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const root = await makeTempDir('poc-cleanup-failure-observation-'), originalOpen = fs.open, originalStat = fs.lstat;
try {
  const home = path.join(root, 'home'), cacheRoot = path.join(root, 'owned-cache');
  const probes = path.join(cacheRoot, 'tooling', 'command-probes'), producer = path.join(root, 'producer-cache');
  await fs.mkdir(probes, { recursive: true });
  const marker = path.join(cacheRoot, CACHE_OWNER_FILE);
  await fs.writeFile(marker, JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const command = path.join(root, 'inert-consumer'); await fs.writeFile(command, 'never executed');
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    for (const argument of ['first', 'second']) assert.equal(writePersistentCommandProbeCache({
      providerId: 'cleanup-observation-fixture', command, args: [argument], cwd: root, probeEnv: {},
      toolingConfig: { cache: { dir: producer } }, attempted: [{ ok: true }]
    }), true);
    for (const name of await fs.readdir(path.join(producer, 'command-probes'))) {
      await fs.copyFile(path.join(producer, 'command-probes', name), path.join(probes, name));
    }
    const candidates = (await fs.readdir(probes)).map(name => path.join(probes, name));
    assert.equal(candidates.length, 2);
    const bytes = await Promise.all(candidates.map(file => fs.readFile(file)));
    const input = { cacheRoot, authorityRoots: [cacheRoot] };
    const plan = await planCacheRootCleanup(input);
    assert.equal(plan.operations.length, 2); assert.equal(plan.applyReady, true);
    const apply = () => applyStorageCleanupPlan(plan, { authorityRoots: [cacheRoot], approvedPlanId: plan.planId });
    for (const value of [undefined, null, false, 0, '']) {
      fs.lstat = async (target, ...args) => { if (target === cacheRoot) throw value; return originalStat(target, ...args); };
      const denied = await planCacheRootCleanup(input);
      assert.equal(denied.applyReady, false); assert.equal(denied.authorityError.code, 'ERR_STORAGE_CLEANUP');
      assert.equal(denied.authorityError.message, String(value));
      fs.lstat = originalStat;
      fs.open = async (target, ...args) => { if (candidates.includes(target)) throw value; return originalOpen(target, ...args); };
      const blocked = await planCacheRootCleanup(input);
      assert.equal(blocked.operations.length, 0); assert.equal(blocked.blocked.length, 2);
      assert.equal(blocked.blocked.every(row => row.error.code === 'ERR_STORAGE_CLEANUP'), true);
      const failed = await apply();
      assert.equal(failed.mutationPerformed, false); assert.equal(failed.results.length, 2);
      assert.equal(failed.results.every(row => row.status === 'failed' && row.error.code === 'ERR_STORAGE_CLEANUP'), true);
      fs.open = originalOpen;
    }
    for (const markerValue of [undefined, false, true]) {
      for (const consume of [() => planCacheRootCleanup(input), apply]) {
        let settled = false, attempts = 0, codeReads = 0;
        const primary = Object.defineProperties(new Error('original cleanup qualification retains work'), {
          ...(markerValue === undefined ? {} : { cacheOwnershipPending: { value: markerValue } }),
          cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
          code: { get() { codeReads += 1; return 'EIO'; } }
        });
        fs.open = async (target, ...args) => {
          if (candidates.includes(target)) { attempts += 1; throw primary; }
          return originalOpen(target, ...args);
        };
        const failure = await rejected(consume);
        assert.equal(failure.cause, primary); assert.equal(isStorageObservationFailure(failure), true);
        assert.equal(codeReads, 0); assert.equal(attempts, 1, 'pending qualification cannot proceed to another cleanup row');
        primary.cacheOwnershipReleased = () => true;
        assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
        assert.equal(failure.cacheOwnershipReleased(), true);
        fs.open = originalOpen;
      }
    }
    for (const value of [undefined, null, false, 0, '']) {
      const primary = Object.freeze(Object.defineProperty(new Error('cleanup code inspection failed'), 'code', {
        get() { throw value; }
      }));
      fs.open = async (target, ...args) => { if (candidates.includes(target)) throw primary; return originalOpen(target, ...args); };
      const failure = await rejected(apply);
      assert.equal(failure.cause, primary); assert.equal(failure.errors[1].cause, value);
      assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
    }
    {
      let settled = false;
      const inspection = Object.assign(new Error('cleanup message inspection owns independent native work'), {
        cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
      });
      const primary = new Error('replace before freezing'); delete primary.stack;
      Object.freeze(Object.defineProperty(primary, 'message', { get() { throw inspection; } }));
      fs.open = async (target, ...args) => { if (candidates.includes(target)) throw primary; return originalOpen(target, ...args); };
      const failure = await rejected(apply);
      assert.equal(failure.cause, primary); assert.equal(failure.errors[1], inspection);
      inspection.cacheOwnershipReleased = () => true;
      assert.equal(failure.cacheOwnershipReleased(), false); settled = true;
      assert.equal(failure.cacheOwnershipReleased(), true);
    }
    {
      const primary = Object.freeze(Object.assign(new Error('unknown cleanup qualification work'), { cacheOwnershipPending: true }));
      fs.open = async (target, ...args) => { if (candidates.includes(target)) throw primary; return originalOpen(target, ...args); };
      const failure = await rejected(() => planCacheRootCleanup(input));
      assert.equal(failure.cacheOwnershipReleased(), false);
    }
    fs.open = originalOpen;
    for (let index = 0; index < candidates.length; index++) assert.deepEqual(await fs.readFile(candidates[index]), bytes[index]);
    assert.equal((await planCacheRootCleanup(input)).operations.length, 2);
    // Keep actual positive deletion coverage in cleanup-authority.test.js; this
    // focused fixture only observes failure propagation and unchanged bytes.
  });
} finally { fs.open = originalOpen; fs.lstat = originalStat; await rmDirRecursive(root); }
console.log('cleanup-failure-observation passed');
