import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStorageCli } from '../../../tools/storage/cli.js';
import { storagePlanDigest } from '../../../src/shared/storage/migration-plan.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-storage-cli-reviewed-context-'));
const home = path.join(root, 'home'), repoA = path.join(root, 'repo-a'), repoB = path.join(root, 'repo-b');
const target = path.join(root, 'selected-models');
const originalLog = console.log, originalExitCode = process.exitCode;
const invoke = async (args, repo = repoA, options = {}) => {
  const output = []; console.log = value => output.push(value); process.exitCode = undefined;
  try {
    const receipt = await runStorageCli([...args, '--repo', repo, '--home', home, '--json'], options);
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]), receipt);
    return { receipt, exitCode: process.exitCode || 0 };
  } finally { console.log = originalLog; process.exitCode = originalExitCode; }
};
try {
  await fs.mkdir(repoA); await fs.mkdir(repoB);
  applyTestEnv({ cacheRoot: path.join(home, 'cache'), embeddings: 'off' });
  await withTemporaryEnv({ PAIROFCLEATS_MODELS_DIR: null, PAIROFCLEATS_TOOLING_DIR: null, PAIROFCLEATS_DICT_DIR: null,
    PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_HOME: null }, async () => {
    const planned = await invoke(['configure-plan', '--category', 'models', '--path', target]);
    assert.equal(planned.exitCode, 0);
    const { planId, dryRun, ...body } = planned.receipt;
    assert.equal(planId, storagePlanDigest(body)); assert.equal(dryRun, true);
    const planFile = path.join(root, 'reviewed-model-plan.json');
    await fs.writeFile(planFile, JSON.stringify(planned.receipt));
    const applyArgs = ['configure-apply', '--category', 'models', '--path', target, '--plan', planFile, '--plan-id', planId];
    const before = await fs.readdir(root, { recursive: true });
    const otherRepo = await invoke(applyArgs, repoB);
    assert.equal(otherRepo.exitCode, 1);
    assert.equal(otherRepo.receipt.mutationPerformed, false);
    assert.match(otherRepo.receipt.error.message, /repository context changed/);
    const changedSource = await withTemporaryEnv({ PAIROFCLEATS_MODELS_DIR: path.join(root, 'new-explicit-model-source') }, () => invoke(applyArgs));
    assert.equal(changedSource.exitCode, 1);
    assert.equal(changedSource.receipt.mutationPerformed, false);
    assert.match(changedSource.receipt.error.message, /launch sources changed/);
    const narrowed = await invoke([...applyArgs, '--max-entries', '1']);
    assert.equal(narrowed.exitCode, 1);
    assert.equal(narrowed.receipt.error.code, 'ERR_STORAGE_WORKFLOW_INTENT');
    assert.deepEqual(await fs.readdir(root, { recursive: true }), before, 'rejected apply contexts create no locator, receipt, lock or category directory');

    for (const args of [['cleanup-plan', '--category', 'models'], ['cleanup-plan', '--path', path.join(root, 'different-probes')],
      ['inspect', '--category', 'models', '--path', target], ['inspect', '--category', 'dictionaries', '--plan', planFile],
      ['doctor', '--category', 'not-a-storage-category'], ['policy-plan', '--category', 'command-probes', '--enabled=invalid'],
      ['inspect', '--max-entries', '0']]) {
      const result = await invoke(args);
      assert.equal(result.exitCode, 1, args.join(' '));
      assert.equal(result.receipt.mutationPerformed, false);
    }
    const policy = await invoke(['policy-plan', '--category', 'command-probes', '--enabled=false', '--enabled', 'true', '--entry-limit', '0']);
    assert.equal(policy.receipt.after.enabled, true);
    assert.equal(policy.receipt.after.entryLimit, 0);
    const policyFile = path.join(root, 'reviewed-policy.json');
    await fs.writeFile(policyFile, JSON.stringify(policy.receipt));
    const policyBefore = await fs.readdir(root, { recursive: true });
    const policyMismatch = await invoke(['policy-apply', '--category', 'command-probes', '--plan', policyFile,
      '--plan-id', policy.receipt.planId], repoB);
    assert.equal(policyMismatch.receipt.mutationPerformed, false);
    assert.match(policyMismatch.receipt.error.message, /repository context changed/);
    assert.deepEqual(await fs.readdir(root, { recursive: true }), policyBefore);

    const explained = await invoke(['explain', '--category', 'models']);
    assert.deepEqual(Object.keys(explained.receipt.layout.descriptors), ['models']);
    assert.equal(explained.receipt.classes.every(entry => entry.category === 'models'), true);
    const doctor = await invoke(['doctor', '--category', 'models']);
    assert.equal(doctor.receipt.inventory.items.every(item => item.category === 'models'), true);
    assert.equal(doctor.receipt.leaseInventory.every(item => item.categories.every(category => category === 'models')), true);
    const probeDoctor = await invoke(['doctor', '--category', 'command-probes']);
    assert.equal(probeDoctor.receipt.category, 'command-probes');
    assert.equal(probeDoctor.receipt.cleanupAuthority, false);
    const cancelled = new AbortController(); cancelled.abort();
    const stopped = await invoke(['explain'], repoA, { signal: cancelled.signal });
    assert.equal(stopped.receipt.state, 'cancelled'); assert.equal(stopped.receipt.mutationPerformed, false);
    assert.deepEqual(await fs.readdir(root, { recursive: true }), policyBefore, 'read-only diagnosis and pre-cancellation create no owner metadata');
  });
} finally { console.log = originalLog; process.exitCode = originalExitCode; await fs.rm(root, { recursive: true, force: true }); }
console.log('Storage CLI preserves exact reviewed context and rejects ignored selectors.');
