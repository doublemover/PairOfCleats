import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStoragePolicy, applyStoragePolicy } from '../../../src/shared/storage/probe-policy.js';
import { planLifecycleCleanup, applyLifecycleCleanup } from '../../../src/shared/storage/cleanup.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { applyTestEnv, ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/lifecycle-quota-cleanup/')[1];
assert.ok(['physical-overlap-and-minimal-cleanup', 'stable-noop-convergence', 'active-original-lease-refusal',
  'policy-and-root-change-refusal', 'pins-and-saved-evidence', 'unknown-and-bounded-inventory',
  'real-volume-reserve', 'cli-lifecycle-composition'].includes(mode));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scope = path.join(repositoryRoot, '.tmp', 'tests', 'lifecycle-quota-cleanup');
assertNoSymlinkPath(repositoryRoot, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-'));
const home = path.join(temporary, 'home'), repoRoot = path.join(temporary, 'project'); await fs.mkdir(repoRoot);
const layout = resolveStorageLayout({ home, env: {} }), cacheRoot = layout.descriptors.cache.path;
const probes = path.join(cacheRoot, 'tooling', 'command-probes');
let lease = null;
const configure = async policy => {
  const plan = await planStoragePolicy({ home, repoRoot, category: 'lifecycle', patch: policy });
  return applyStoragePolicy(plan, { home, repoRoot, category: 'lifecycle', approvedPlanId: plan.planId });
};
const preview = (options = {}) => planLifecycleCleanup({ layout, maxEntries: 1000, maxDurationMs: 10000, ...options });
const apply = plan => applyLifecycleCleanup(plan, { layout, approvedPlanId: plan.planId });
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    await fs.mkdir(probes, { recursive: true });
    const marker = path.join(cacheRoot, CACHE_OWNER_FILE);
    await fs.writeFile(marker, JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
    for (const label of ['one', 'two']) assert.equal(writePersistentCommandProbeCache({ providerId: 'lifecycle-quota-fixture',
      command: process.execPath, args: [label], cwd: temporary, probeEnv: {},
      toolingConfig: { cache: { dir: path.join(cacheRoot, 'tooling') } },
      attempted: [{ ok: true, stdout: label.padEnd(16384, 'x') }] }), true);
    const files = (await fs.readdir(probes)).filter(name => name.endsWith('.json')).map(name => path.join(probes, name));
    assert.equal(files.length, 2);
    const allocated = async file => {
      const stat = await fs.stat(file, { bigint: true });
      assert.equal(typeof stat.blocks, 'bigint', 'native allocation is required for this qualification');
      return Number(stat.blocks * 512n);
    };
    const blocks = await Promise.all(files.map(allocated)); assert.ok(blocks.every(value => value > 0));
    const hardBytes = await allocated(marker) + Math.max(...blocks);
    await configure({ enabled: true, global: {}, scopes: [{ scope: 'category', id: 'cache', hardBytes }] });
    if (mode === 'physical-overlap-and-minimal-cleanup' || mode === 'stable-noop-convergence') {
      const plan = await preview(); assert.equal(plan.complete, true); assert.equal(plan.applyReady, true);
      assert.equal(plan.observation.quota.selected.length, 1); assert.equal(plan.observation.probePlan.operations.length, 1);
      assert.equal(plan.observation.quota.measuredUniqueAllocatedBytes, plan.observation.inventory.totals.uniqueAllocatedBytes,
        'overlapping home/cache/repository roots use one physical footprint');
      const result = await apply(plan); assert.equal(result.complete, true); assert.equal(result.mutationPerformed, true);
      assert.equal(result.cleanup.results.filter(row => row.status === 'deleted').length, 1);
      assert.equal(result.actualReclaimedBytes, null, 'native unlink allocation is not a free-space recovery claim');
      assert.equal(result.after.quota.admission, 'admit');
      assert.equal((await fs.readdir(probes)).filter(name => name.endsWith('.json')).length, 1);
      if (mode === 'stable-noop-convergence') {
        const next = await preview(); assert.equal(next.observation.quota.selected.length, 0); assert.equal(next.applyReady, true);
        const before = await fs.readdir(home, { recursive: true }), again = await apply(next);
        assert.equal(again.complete, true); assert.equal(again.mutationPerformed, false);
        assert.deepEqual(await fs.readdir(home, { recursive: true }), before);
      }
    } else if (mode === 'active-original-lease-refusal') {
      const plan = await preview(); assert.equal(plan.applyReady, true);
      lease = acquireRepoCacheAccessLease(probes, { scope: 'original-live-probe-reader' });
      await assert.rejects(apply(plan), /changed|no longer ready/);
      for (const file of files) assert.ok((await fs.stat(file)).isFile());
      assert.equal(lease.release(), true); lease = null;
      assert.equal((await apply(await preview())).complete, true);
    } else if (mode === 'policy-and-root-change-refusal') {
      const plan = await preview(), before = await Promise.all(files.map(file => fs.readFile(file)));
      const changed = { ...layout, descriptors: { ...layout.descriptors, cache: { ...layout.descriptors.cache, path: path.join(home, 'other-cache') } } };
      await assert.rejects(applyLifecycleCleanup(plan, { layout: changed, approvedPlanId: plan.planId }), /roots changed/);
      await configure({ enabled: false }); await assert.rejects(apply(plan), /changed/);
      for (const [index, file] of files.entries()) assert.deepEqual(await fs.readFile(file), before[index]);
    } else if (mode === 'pins-and-saved-evidence') {
      const saved = path.join(home, 'reports', 'saved.json'), unknown = path.join(home, 'unexpected-owner-data.bin');
      await fs.mkdir(path.dirname(saved), { recursive: true }); await fs.writeFile(saved, 'saved evidence'); await fs.writeFile(unknown, Buffer.alloc(8192, 42));
      for (const file of files) {
        const row = JSON.parse(await fs.readFile(file, 'utf8')); row.pinned = true; await fs.writeFile(file, JSON.stringify(row));
      }
      const before = await Promise.all(files.map(file => fs.readFile(file))), plan = await preview();
      assert.equal(plan.applyReady, false); assert.equal(plan.observation.quota.admission, 'deny-space-needed');
      assert.equal(plan.observation.probePlan.operations.length, 0); assert.ok(plan.observation.quota.blocked.length >= 4);
      await assert.rejects(apply(plan), /complete reviewed plan/);
      for (const [index, file] of files.entries()) assert.deepEqual(await fs.readFile(file), before[index]);
      assert.equal(await fs.readFile(saved, 'utf8'), 'saved evidence'); assert.deepEqual(await fs.readFile(unknown), Buffer.alloc(8192, 42));
    } else if (mode === 'unknown-and-bounded-inventory') {
      const bounded = await preview({ maxEntries: 2 }); assert.equal(bounded.complete, false); assert.equal(bounded.applyReady, false);
      assert.equal(bounded.stopReason, 'entry-budget'); await assert.rejects(apply(bounded));
      const controller = new AbortController(); controller.abort();
      const cancelled = await preview({ signal: controller.signal }); assert.equal(cancelled.complete, false); assert.equal(cancelled.stopReason, 'cancelled');
      await configure({ enabled: true, global: {}, scopes: [{ scope: 'repository', id: 'unadmitted-repo', hardBytes: 0 }] });
      const repositoryFile = path.join(layout.descriptors.repos.path, 'unadmitted-repo', 'saved.json');
      await fs.mkdir(path.dirname(repositoryFile), { recursive: true }); await fs.writeFile(repositoryFile, 'retained repository evidence');
      const unknown = await preview(); assert.equal(unknown.applyReady, false); assert.equal(unknown.observation.quota.admission, 'defer-accounting-required');
      assert.equal(await fs.readFile(repositoryFile, 'utf8'), 'retained repository evidence');
    } else if (mode === 'real-volume-reserve') {
      await configure({ enabled: true, global: { minimumFreeBytes: Number.MAX_SAFE_INTEGER }, scopes: [] });
      const plan = await preview(), observation = plan.observation;
      assert.equal(observation.freeSpace.complete, true); assert.equal(plan.applyReady, false);
      assert.equal(observation.quota.admission, 'deny-space-needed');
      const stat = await fs.lstat(observation.freeSpace.observedPath, { bigint: true });
      assert.equal(observation.quota.freeSpaceScopeId, String(stat.dev));
      assert.ok(observation.quota.requiredReserveReclaimBytes > observation.quota.plannedReserveReclaimBytes);
      for (const file of files) assert.ok((await fs.stat(file)).isFile());
    } else {
      await configure({ enabled: true, global: {}, scopes: [] });
      const env = applyTestEnv({ syncProcess: false }), reviewed = path.join(temporary, 'cleanup.json');
      const invoke = args => runNode(['tools/storage/cli.js', ...args, '--repo', repoRoot, '--home', home, '--category', 'lifecycle', '--json'],
        'lifecycle cleanup CLI', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
      const planned = invoke(['cleanup-plan']); assert.equal(planned.status, 0, planned.stderr || planned.stdout);
      const plan = JSON.parse(planned.stdout); assert.equal(plan.observation.quota.admission, 'admit');
      assert.ok(plan.scope.roots.some(root => root.id === 'legacy-command-probes'));
      await fs.writeFile(reviewed, JSON.stringify(plan));
      const applied = invoke(['cleanup-apply', '--plan', reviewed, '--plan-id', plan.planId]);
      assert.equal(applied.status, 0, applied.stderr || applied.stdout); assert.equal(JSON.parse(applied.stdout).mutationPerformed, false);
      assert.notEqual(invoke(['cleanup-plan', '--path', probes]).status, 0, 'a path selector cannot silently narrow a global policy');
    }
  });
} finally {
  lease?.release();
  assertNoSymlinkPath(repositoryRoot, temporary);
  const actual = await fs.realpath(temporary), parent = await fs.realpath(scope); assert.equal(path.dirname(actual), parent);
  await rmDirRecursive(actual, { retries: 0 });
}
console.log('Lifecycle quota cleanup composes actual probe authority, physical accounting and bounded fresh convergence.');
