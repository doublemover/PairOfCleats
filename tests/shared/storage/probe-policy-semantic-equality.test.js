import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameCommandProbeStoragePolicy } from '../../../src/contracts/schemas/storage-policy.js';
import { planStorageProbePolicy, applyStorageProbePolicy } from '../../../src/shared/storage/probe-policy.js';
import { readStorageProbePolicy } from '../../../src/shared/storage/probe-policy-read.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/probe-policy-semantic-equality/')[1];
assert.ok(['semantic-policy-equality', 'strict-fields-and-stale-plan'].includes(mode));
const original = { enabled: false, entryLimit: 20, maxAgeMs: 1000, hardBytes: 2000 };
const reordered = Object.fromEntries(Object.entries(original).reverse());
assert.equal(sameCommandProbeStoragePolicy(original, reordered), true);
for (const [key, value] of [['enabled', true], ['entryLimit', 21], ['maxAgeMs', 1001], ['hardBytes', 2001]]) {
  assert.equal(sameCommandProbeStoragePolicy(original, { ...reordered, [key]: value }), false);
}
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const taskRoot = path.join(repositoryRoot, '.tmp', 'tests', 'storage-policy-equality');
assertNoSymlinkPath(repositoryRoot, taskRoot, { allowMissing: true }); await fs.mkdir(taskRoot, { recursive: true });
const temporary = await fs.mkdtemp(path.join(taskRoot, 'case-'));
try {
  const home = path.join(temporary, 'home'), repoRoot = path.join(temporary, 'project'); await fs.mkdir(repoRoot);
  const plan = await planStorageProbePolicy({ home, repoRoot, patch: original });
  const applied = await applyStorageProbePolicy(plan, { home, repoRoot, category: 'command-probes', approvedPlanId: plan.planId });
  assert.equal(applied.complete, true);
  const selectionBytes = await fs.readFile(applied.receiptFile), before = readStorageProbePolicy(home);
  assert.equal(before.status, 'present'); assert.deepEqual(before.policy, original);
  const locator = JSON.parse(await fs.readFile(before.target, 'utf8'));
  if (mode === 'semantic-policy-equality') {
    locator.policies['command-probes'].policy = reordered;
    await fs.writeFile(before.target, JSON.stringify(locator));
    const observed = readStorageProbePolicy(home);
    assert.equal(observed.status, 'present'); assert.equal(observed.policyId, before.policyId); assert.deepEqual(observed.policy, original);
    assert.notEqual(observed.sha256, before.sha256, 'raw locator identity still tracks a rewritten file');
    assert.deepEqual(await fs.readFile(applied.receiptFile), selectionBytes, 'semantic equality never rewrites the immutable receipt');
  } else {
    for (const invalid of [{ ...reordered, futureField: true }, { ...reordered, enabled: 'false' },
      { ...reordered, maxAgeMs: null }, { enabled: false, entryLimit: 20, hardBytes: 2000 }]) {
      assert.throws(() => sameCommandProbeStoragePolicy(original, invalid));
      locator.policies['command-probes'].policy = invalid; await fs.writeFile(before.target, JSON.stringify(locator));
      const rejected = readStorageProbePolicy(home); assert.equal(rejected.status, 'invalid'); assert.equal(rejected.policy, null);
      assert.deepEqual(await fs.readFile(applied.receiptFile), selectionBytes);
    }
    locator.policies['command-probes'].policy = original; await fs.writeFile(before.target, JSON.stringify(locator));
    const reviewed = await planStorageProbePolicy({ home, repoRoot, patch: { hardBytes: 4000 } });
    locator.policies['command-probes'].policy = reordered; await fs.writeFile(before.target, JSON.stringify(locator));
    const bytes = await fs.readFile(before.target);
    await assert.rejects(applyStorageProbePolicy(reviewed, { home, repoRoot, category: 'command-probes', approvedPlanId: reviewed.planId }), /changed after review/);
    assert.deepEqual(await fs.readFile(before.target), bytes, 'equivalent policy meaning does not waive stale reviewed-file identity');
    assert.deepEqual(await fs.readFile(applied.receiptFile), selectionBytes);
  }
} finally {
  assertNoSymlinkPath(repositoryRoot, temporary);
  const actualTaskRoot = await fs.realpath(taskRoot), actualTemporary = await fs.realpath(temporary);
  assert.equal(path.dirname(actualTemporary), actualTaskRoot);
  await rmDirRecursive(actualTemporary, { retries: 0 });
}
console.log('Probe policy meaning ignores JSON order while strict fields, immutable bytes and stale review identities remain binding.');
