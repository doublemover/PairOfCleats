import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { planStorageProbePolicy, applyStorageProbePolicy } from '../../../src/shared/storage/probe-policy.js';
import { readStorageProbePolicy } from '../../../src/shared/storage/probe-policy-read.js';
import { COMMAND_PROBE_POLICY_DEFAULTS, assertCommandProbeStoragePolicy } from '../../../src/contracts/schemas/storage-policy.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache,
  invalidatePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';

const temporary = await makeTempDir('poc-probe-policy-lifecycle-');
try {
  const home = path.join(temporary, 'home');
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    const base = { providerId: 'policy-fixture', command: process.execPath, args: ['initial'], cwd: temporary,
      probeEnv: {}, toolingConfig: { cache: { dir: path.join(temporary, 'cache') } }, attempted: [{ ok: true }] };
    assert.deepEqual(readStorageProbePolicy(home).policy, COMMAND_PROBE_POLICY_DEFAULTS);
    assert.throws(() => assertCommandProbeStoragePolicy(JSON.parse('{"__proto__":0}'), { partial: true }));
    assert.equal(writePersistentCommandProbeCache(base), true);
    assert.equal(readPersistentCommandProbeCache(base)?.cached, true, 'omitted success TTL uses policy age, rather than Number(null) expiry');
    assert.equal(readPersistentCommandProbeCache({ ...base, successTtlMs: 0 }), null);
    const directory = path.join(temporary, 'cache', 'command-probes');
    const [initialName] = await fs.readdir(directory);
    const initialFile = path.join(directory, initialName);
    const initialBytes = await fs.readFile(initialFile);
    const configure = async patch => {
      const plan = await planStorageProbePolicy({ home, patch });
      assert.equal(plan.mutationPerformed, false);
      await applyStorageProbePolicy(plan, { approvedPlanId: plan.planId, home, category: 'command-probes' });
      return plan;
    };
    const disabled = await planStorageProbePolicy({ home, patch: { enabled: false } });
    assert.equal(readStorageProbePolicy(home).status, 'missing', 'preview creates no policy locator');
    await assert.rejects(() => applyStorageProbePolicy(disabled, { approvedPlanId: disabled.planId,
      home: path.join(temporary, 'wrong'), category: 'command-probes' }), /exact reviewed/);
    await assert.rejects(() => applyStorageProbePolicy(disabled, { approvedPlanId: '0'.repeat(64), home, category: 'command-probes' }), /exact reviewed/);
    const applied = await applyStorageProbePolicy(disabled, { approvedPlanId: disabled.planId, home, category: 'command-probes' });
    assert.equal(applied.cacheMutationPerformed, false);
    assert.equal(readPersistentCommandProbeCache(base), null);
    assert.equal(writePersistentCommandProbeCache({ ...base, args: ['disabled'] }), false);
    assert.equal(invalidatePersistentCommandProbeCache(base), false);
    assert.deepEqual(await fs.readFile(initialFile), initialBytes);
    const zero = await configure({ enabled: true, entryLimit: 0 });
    assert.equal(zero.after.hardBytes, COMMAND_PROBE_POLICY_DEFAULTS.hardBytes, 'omitted fields preserve prior/default policy');
    assert.equal(readPersistentCommandProbeCache(base), null);
    assert.equal(writePersistentCommandProbeCache(base), false);
    assert.deepEqual(await fs.readFile(initialFile), initialBytes, 'literal zero does not schedule deletion');
    for (const field of ['hardBytes', 'maxAgeMs']) {
      await configure({ entryLimit: 2, hardBytes: 65536, maxAgeMs: 86400000, [field]: 0 });
      assert.equal(readPersistentCommandProbeCache(base), null, `${field} zero bypasses reads`);
      assert.equal(writePersistentCommandProbeCache(base), false, `${field} zero bypasses writes`);
      assert.deepEqual(await fs.readFile(initialFile), initialBytes);
    }
    await configure({ entryLimit: 1, hardBytes: 65536, maxAgeMs: 86400000 });
    assert.equal(writePersistentCommandProbeCache({ ...base, args: ['replacement'] }), true);
    assert.equal((await fs.readdir(directory)).length, 1, 'real producer admission obeys reviewed entry bound');
    const [name] = await fs.readdir(directory);
    const kept = path.join(directory, name);
    const pinned = { ...JSON.parse(await fs.readFile(kept)), pinned: true };
    await fs.writeFile(kept, JSON.stringify(pinned));
    const pinnedBytes = await fs.readFile(kept);
    assert.equal(writePersistentCommandProbeCache({ ...base, args: ['unknown-must-not-evict'] }), false);
    assert.deepEqual(await fs.readFile(kept), pinnedBytes);
    await configure({ hardBytes: 1 });
    assert.equal(writePersistentCommandProbeCache({ ...base, args: ['too-large-for-policy'] }), false);
    assert.deepEqual(await fs.readFile(kept), pinnedBytes, 'unsatisfiable payload never evicts bytes to discover it cannot fit');
    const current = readStorageProbePolicy(home);
    const selection = current.value.policies['command-probes'].selectionId;
    const receiptFile = path.join(home, 'config', 'storage-policy-selections', `${selection}.json`);
    const receiptBytes = await fs.readFile(receiptFile);
    await fs.unlink(receiptFile);
    assert.equal(readStorageProbePolicy(home).status, 'invalid', 'missing immutable receipt cannot fall back to defaults');
    assert.equal(writePersistentCommandProbeCache(base), false);
    assert.equal(readPersistentCommandProbeCache(base), null);
    await fs.writeFile(receiptFile, receiptBytes);
    const stale = await planStorageProbePolicy({ home, patch: { maxAgeMs: 1000 } });
    await configure({ hardBytes: 32768 });
    await assert.rejects(() => applyStorageProbePolicy(stale, { approvedPlanId: stale.planId, home, category: 'command-probes' }), /changed after review/);
    const active = readStorageProbePolicy(home).value.policies['command-probes'].selectionId;
    await fs.appendFile(path.join(home, 'config', 'storage-policy-selections', `${active}.json`), ' ');
    assert.equal(readStorageProbePolicy(home).status, 'invalid');
    assert.equal(writePersistentCommandProbeCache(base), false);
    assert.deepEqual(await fs.readFile(kept), pinnedBytes);
    for (const patch of [{ entryLimit: -1 }, { hardBytes: Infinity }, { maxAgeMs: 1.5 }, { arbitrary: true }]) {
      await assert.rejects(() => planStorageProbePolicy({ home, patch }));
    }
  });
} finally { await rmDirRecursive(temporary); }
console.log('probe reviewed machine policy lifecycle passed');
