import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStoragePolicy, applyStoragePolicy } from '../../../src/shared/storage/probe-policy.js';
import { planLifecycleCleanup, applyLifecycleCleanup } from '../../../src/shared/storage/cleanup.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/lifecycle-repository-cleanup/')[1];
assert.ok(['reviewed-subset-and-convergence', 'active-original-reader', 'mixed-evidence-and-pins',
  'changed-original-file-set', 'policy-change-between-unlinks', 'cancellation-between-unlinks'].includes(mode));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scope = path.join(repositoryRoot, '.tmp', 'tests', 'lifecycle-repositories');
assertNoSymlinkPath(repositoryRoot, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), home = path.join(temporary, 'home');
const layout = resolveStorageLayout({ home, env: {} }), cacheRoot = layout.descriptors.cache.path;
const repoId = 'fixture-0123456789ab', root = path.join(cacheRoot, 'repos', repoId), controller = new AbortController();
const files = [0, 1].map(index => path.join(root, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${String(index).padStart(40, 'a')}.json`));
const payload = JSON.stringify(withGeneratedCacheMetadata({ chunks: [{ name: 'finite cache fixture', text: 'x'.repeat(16384) }] }, 'tree-sitter-chunks'));
const unlink = fsSync.unlinkSync;
const nativePath = value => process.platform === 'win32' ? path.toNamespacedPath(value).toLowerCase() : path.resolve(value);
let lease = null;
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    await fs.mkdir(path.dirname(files[0]), { recursive: true });
    await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
    for (const filename of files) await fs.writeFile(filename, payload);
    const stat = await fs.stat(files[0], { bigint: true }); assert.equal(typeof stat.blocks, 'bigint');
    const allocated = Number(stat.blocks * 512n); assert.ok(allocated > 0);
    const configure = async hardBytes => {
      const plan = await planStoragePolicy({ home, repoRoot: repositoryRoot, category: 'lifecycle',
        patch: { enabled: true, global: {}, scopes: [{ scope: 'repository', id: repoId, hardBytes }] } });
      return applyStoragePolicy(plan, { home, repoRoot: repositoryRoot, category: 'lifecycle', approvedPlanId: plan.planId });
    };
    const selected = await configure(mode.endsWith('between-unlinks') ? 0 : allocated);
    const preview = () => planLifecycleCleanup({ layout, maxEntries: 1000, maxDurationMs: 10000, signal: controller.signal });
    const apply = plan => applyLifecycleCleanup(plan, { layout, approvedPlanId: plan.planId, signal: controller.signal });
    if (mode === 'active-original-reader') {
      lease = acquireRepoCacheAccessLease(root, { scope: 'original-repository-quota-reader' });
      const blocked = await preview(); assert.equal(blocked.applyReady, false); assert.equal(blocked.observation.repositoryPlans.length, 0);
      assert.equal(blocked.observation.quota.admission, 'deny-space-needed');
      for (const filename of files) assert.equal(await fs.readFile(filename, 'utf8'), payload);
      assert.equal(lease.release(), true); lease = null;
      assert.equal((await preview()).applyReady, true);
    } else if (mode === 'mixed-evidence-and-pins') {
      const saved = path.join(root, 'reports', 'retained-answer.txt'); await fs.mkdir(path.dirname(saved)); await fs.writeFile(saved, 'saved evidence');
      await fs.writeFile(files[1], JSON.stringify(withGeneratedCacheMetadata({ chunks: [], pinned: true }, 'tree-sitter-chunks')));
      const plan = await preview(); assert.equal(plan.applyReady, false); assert.equal(plan.observation.repositoryPlans.length, 0);
      await assert.rejects(apply(plan));
      assert.equal(await fs.readFile(saved, 'utf8'), 'saved evidence'); assert.equal(await fs.readFile(files[0], 'utf8'), payload);
      assert.equal(JSON.parse(await fs.readFile(files[1], 'utf8')).pinned, true);
    } else {
      const plan = await preview(); assert.equal(plan.complete, true); assert.equal(plan.applyReady, true);
      assert.equal(plan.observation.probePlan.operations.length, 0); assert.equal(plan.observation.repositoryPlans.length, 1);
      const original = plan.observation.repositoryPlans[0]; assert.equal(original.repoId, repoId);
      if (mode === 'changed-original-file-set') {
        const saved = path.join(root, 'late-user-data'); await fs.writeFile(saved, 'original authority must be rechecked');
        await assert.rejects(apply(plan)); assert.equal(await fs.readFile(saved, 'utf8'), 'original authority must be rechecked');
        for (const filename of files) assert.equal(await fs.readFile(filename, 'utf8'), payload);
      } else if (mode.endsWith('between-unlinks')) {
        assert.equal(original.selectedFiles.length, 2); let deleted = 0;
        fsSync.unlinkSync = (filename, ...args) => {
          const result = unlink(filename, ...args);
          if (typeof filename === 'string' && files.some(file => nativePath(file) === nativePath(filename))) {
            deleted++;
            if (deleted === 1) {
              if (mode === 'policy-change-between-unlinks') fsSync.writeFileSync(selected.file, '{changed policy');
              else controller.abort();
            }
          }
          return result;
        };
        const result = await apply(plan); assert.equal(result.complete, false); assert.equal(result.mutationPerformed, true);
        assert.equal(result.stopReason, mode === 'policy-change-between-unlinks' ? 'policy-changed' : 'cancelled');
        assert.equal(deleted, 1); assert.equal((await fs.readdir(path.dirname(files[0]))).length, 1);
      } else {
        assert.equal(original.selectedFiles.length, 1);
        const target = path.join(root, original.selectedFiles[0]), other = files.find(filename => filename !== target);
        const result = await apply(plan); assert.equal(result.complete, true); assert.equal(result.repositoryCleanup.complete, true);
        assert.equal(result.repositoryCleanup.results[0].deletedFiles.length, 1); assert.equal(result.actualReclaimedBytes, null);
        await assert.rejects(fs.stat(target), { code: 'ENOENT' }); assert.equal(await fs.readFile(other, 'utf8'), payload);
        const next = await preview(); assert.equal(next.observation.quota.admission, 'admit');
        const repeated = await apply(next); assert.equal(repeated.complete, true); assert.equal(repeated.mutationPerformed, false);
      }
    }
  });
} finally {
  fsSync.unlinkSync = unlink; lease?.release();
  assertNoSymlinkPath(repositoryRoot, temporary);
  assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope)); await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Lifecycle quotas compose reviewed repository subsets with original producer, lease and mutation owners.');
