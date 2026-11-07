import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_POLICY_VERSION, assertLifecycleQuotaPolicy, sameStoragePolicy } from '../../../src/contracts/schemas/storage-policy.js';
import { planStoragePolicy, applyStoragePolicy } from '../../../src/shared/storage/probe-policy.js';
import { readStoragePolicy } from '../../../src/shared/storage/probe-policy-read.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/lifecycle-policy-publication/')[1];
assert.ok(['strict-scopes-and-budgets', 'reviewed-publication-and-restart', 'semantic-policy-equality',
  'stale-selection-preserves-current', 'input-snapshot-before-publication', 'obsolete-format-refusal', 'cli-review-and-selector-refusal'].includes(mode));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scope = path.join(repositoryRoot, '.tmp', 'tests', 'lifecycle-policy-publication');
assertNoSymlinkPath(repositoryRoot, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-'));
const home = path.join(temporary, 'home'), repoRoot = path.join(temporary, 'project'); await fs.mkdir(repoRoot);
const original = { enabled: true, global: { softBytes: 8192, hardBytes: 16384, minimumFreeBytes: 4096, retainCount: 1, maxAgeMs: 0 },
  scopes: [{ scope: 'category', id: 'cache', hardBytes: 4096 }, { scope: 'repository', id: 'repo-a', retainCount: 2 }] };
const read = () => readStoragePolicy(home, { category: 'lifecycle' });
const publish = async patch => {
  const plan = await planStoragePolicy({ home, repoRoot, category: 'lifecycle', patch });
  return applyStoragePolicy(plan, { home, repoRoot, category: 'lifecycle', approvedPlanId: plan.planId });
};
try {
  if (mode === 'strict-scopes-and-budgets') {
    assert.equal(assertLifecycleQuotaPolicy(original), original);
    assertLifecycleQuotaPolicy({ enabled: false, global: { hardBytes: 0, minimumFreeBytes: 0 }, scopes: [] });
    for (const invalid of [null, {}, { ...original, future: true }, { ...original, enabled: 1 },
      { ...original, global: { hardBytes: -1 } }, { ...original, global: { hardBytes: Number.MAX_SAFE_INTEGER + 1 } },
      { ...original, global: { softBytes: 2, hardBytes: 1 } }, { ...original, global: { freeBytes: 1 } },
      { ...original, scopes: [original.scopes[0], original.scopes[0]] },
      { ...original, scopes: [{ scope: 'category', id: 'cache', hardBytes: null }] },
      { ...original, scopes: new Array(1025).fill(original.scopes[0]) }]) assert.throws(() => assertLifecycleQuotaPolicy(invalid));
    await assert.rejects(planStoragePolicy({ home, category: 'unregistered', patch: original }));
    assert.equal(read().status, 'missing');
  } else if (mode === 'cli-review-and-selector-refusal') {
    const input = path.join(temporary, 'policy.json'), reviewed = path.join(temporary, 'reviewed.json');
    await fs.writeFile(input, JSON.stringify(original));
    const env = applyTestEnv({ syncProcess: false });
    const invoke = args => runNode(['tools/storage/cli.js', ...args, '--repo', repoRoot, '--home', home, '--category', 'lifecycle', '--json'],
      'reviewed lifecycle policy CLI', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
    for (const args of [['policy-plan'], ['policy-plan', '--plan', input, '--hard-bytes', '1'],
      ['policy-plan', '--plan', input, '--no-enabled']]) assert.notEqual(invoke(args).status, 0);
    assert.equal(read().status, 'missing', 'invalid selectors never publish policy or mutate cache data');
    const planned = invoke(['policy-plan', '--plan', input]); assert.equal(planned.status, 0, planned.stderr || planned.stdout);
    const plan = JSON.parse(planned.stdout); assert.deepEqual(plan.after, original); assert.equal(read().status, 'missing');
    await fs.writeFile(reviewed, JSON.stringify(plan));
    const applied = invoke(['policy-apply', '--plan', reviewed, '--plan-id', plan.planId]);
    assert.equal(applied.status, 0, applied.stderr || applied.stdout); assert.equal(JSON.parse(applied.stdout).cacheMutationPerformed, false);
    assert.deepEqual(read().policy, original);
  } else if (mode === 'obsolete-format-refusal') {
    await fs.mkdir(path.join(home, 'config'), { recursive: true });
    const file = path.join(home, 'config', 'storage-policies.json');
    const bytes = JSON.stringify({ schemaVersion: STORAGE_POLICY_VERSION - 1, kind: 'pairofcleats-storage-policy-locator', policies: {} });
    await fs.writeFile(file, bytes); assert.equal(read().status, 'invalid'); assert.equal(readStoragePolicy(home).policy, null);
    await assert.rejects(publish(original), /Invalid storage policy/);
    assert.equal(await fs.readFile(file, 'utf8'), bytes, 'old persisted meaning is refused without overwriting user policy');
  } else if (mode === 'input-snapshot-before-publication') {
    const input = structuredClone(original), planning = planStoragePolicy({ home, repoRoot, category: 'lifecycle', patch: input });
    input.global.hardBytes = 1; input.scopes[0].hardBytes = 1;
    const plan = await planning; assert.deepEqual(plan.after, original);
    assert.equal(Object.isFrozen(plan.after.global), true); assert.equal(Object.isFrozen(plan.after.scopes[0]), true);
    const external = structuredClone(plan), publishing = applyStoragePolicy(external,
      { home, repoRoot, category: 'lifecycle', approvedPlanId: plan.planId });
    external.after.global.hardBytes = 1; external.after.scopes.length = 0;
    await publishing; assert.deepEqual(read().policy, original, 'lock acquisition cannot change the reviewed policy snapshot');
  } else {
    const applied = await publish(original), before = read(), receiptBytes = await fs.readFile(applied.receiptFile);
    if (mode === 'reviewed-publication-and-restart') {
      const cache = path.join(home, 'cache'), saved = path.join(cache, 'saved-report.json'); await fs.mkdir(cache, { recursive: true });
      await fs.writeFile(saved, 'saved evidence');
      const probes = await planStoragePolicy({ home, repoRoot, patch: { enabled: false, hardBytes: 0 } });
      await applyStoragePolicy(probes, { home, repoRoot, category: 'command-probes', approvedPlanId: probes.planId });
      assert.deepEqual(read().policy, original); assert.equal(readStoragePolicy(home).policy.enabled, false);
      await publish({ enabled: false }); assert.equal(read().policy.enabled, false); assert.deepEqual(read().policy.global, original.global);
      assert.equal(await fs.readFile(saved, 'utf8'), 'saved evidence');
      assert.deepEqual(await fs.readFile(applied.receiptFile), receiptBytes);
    } else if (mode === 'semantic-policy-equality') {
      const reordered = { scopes: original.scopes.toReversed().map(scope => Object.fromEntries(Object.entries(scope).reverse())),
        global: Object.fromEntries(Object.entries(original.global).reverse()), enabled: true };
      assert.equal(sameStoragePolicy('lifecycle', original, reordered), true);
      const locator = JSON.parse(await fs.readFile(before.target, 'utf8')); locator.policies.lifecycle.policy = reordered;
      await fs.writeFile(before.target, JSON.stringify(locator)); assert.equal(read().status, 'present');
      locator.policies.lifecycle.policy.global.hardBytes++; await fs.writeFile(before.target, JSON.stringify(locator));
      assert.equal(read().status, 'invalid', 'semantic comparison still binds every exact quota value');
      assert.deepEqual(await fs.readFile(applied.receiptFile), receiptBytes);
    } else {
      const stale = await planStoragePolicy({ home, repoRoot, category: 'lifecycle', patch: { enabled: false } });
      await publish({ global: {} }); const current = await fs.readFile(before.target);
      await assert.rejects(applyStoragePolicy(stale, { home, repoRoot, category: 'lifecycle', approvedPlanId: stale.planId }), /changed after review/);
      assert.deepEqual(await fs.readFile(before.target), current); assert.deepEqual(await fs.readFile(applied.receiptFile), receiptBytes);
      assert.deepEqual(read().policy.global, {}, 'a supplied global record replaces all prior limits explicitly');
    }
  }
} finally {
  assertNoSymlinkPath(repositoryRoot, temporary);
  const actual = await fs.realpath(temporary), parent = await fs.realpath(scope); assert.equal(path.dirname(actual), parent);
  await rmDirRecursive(actual, { retries: 0 });
}
console.log('Reviewed lifecycle quota policy retains current identities, original publication and protected cache bytes.');
