import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSearchFiltersRepo, createInProcessFilterSearch } from '../../helpers/search-filters-repo.js';
import { runGit } from '../../helpers/git-fixture.js';
import { getMetricsDir, getCurrentBuildInfo, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';

const selectedCase = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/filters/branch-checkout-index-metrics/')[1];
assert.ok(['checkout-recovery', 'mixed-historical'].includes(selectedCase));
const fixture = await ensureSearchFiltersRepo({ cacheScope: 'isolated' });
assert.ok(fixture, 'this real branch qualification fixture requires Git');
const { repoRoot, cacheRoot, env } = fixture;
const parent = path.resolve(path.dirname(repoRoot));
for (const target of [repoRoot, cacheRoot]) {
  const relative = path.relative(parent, path.resolve(target));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'cleanup stays inside disposable fixture roots');
}
const search = createInProcessFilterSearch({ repoRoot, env });
const names = payload => [...new Set(payload.prose.map(hit => path.basename(hit.file)))].sort();
const expected = ['CaseFile.TXT', 'alpha.txt', 'beta.txt'];
try {
  runGit(['checkout', '-b', 'observed-A'], { cwd: repoRoot });
  const revision = runGit(['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const metricsDir = await withTemporaryEnv(env, async () => getMetricsDir(repoRoot, loadUserConfig(repoRoot)));
  const metricsPath = path.join(metricsDir, 'index-prose.json');
  const metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
  await fs.writeFile(metricsPath, JSON.stringify({ ...metrics, git: { ...metrics.git, branch: 'observed-A' } }));
  if (selectedCase === 'checkout-recovery') for (let round = 0; round < 2; round++) {
    const payload = await search({ query: 'alpha', args: ['--branch', 'observed-A'] });
    assert.deepEqual(names(payload), expected);
    assert.deepEqual(payload.stats.branchQualification, { requested: 'observed-A', observed: 'observed-A',
      basis: 'current-checkout', revision, state: 'verified', reason: null });
  }
  runGit(['checkout', '-b', 'observed-B'], { cwd: repoRoot });
  assert.equal(JSON.parse(await fs.readFile(metricsPath, 'utf8')).git.branch, 'observed-A');
  if (selectedCase === 'checkout-recovery') for (let round = 0; round < 2; round++) {
    const payload = await search({ query: 'alpha', args: ['--branch', 'observed-B'] });
    assert.deepEqual(names(payload), expected, 'checkout changes need no index rebuild to qualify the current branch');
    assert.equal(payload.stats.branchQualification.observed, 'observed-B');
    assert.equal(payload.stats.branchQualification.revision, revision);
    const mismatch = await search({ query: 'alpha', args: ['--branch', 'observed-A'] });
    assert.deepEqual(names(mismatch), []); assert.equal(mismatch.stats.branchQualification.state, 'mismatch');
  }
  if (selectedCase === 'mixed-historical') {
    const codeMetricsPath = path.join(metricsDir, 'index-code.json');
    const codeMetrics = JSON.parse(await fs.readFile(codeMetricsPath, 'utf8'));
    await fs.writeFile(codeMetricsPath, JSON.stringify({ ...codeMetrics, git: { ...codeMetrics.git, branch: 'conflicting-C' } }));
    const selected = await withTemporaryEnv(env, async () => getCurrentBuildInfo(repoRoot, loadUserConfig(repoRoot)));
    for (const selector of [[], ['--as-of', `build:${selected.buildId}`]]) {
      const both = await search({ query: 'alpha OR equal', mode: 'both', args: ['--branch', 'observed-B', ...selector] });
      assert.deepEqual(names(both), expected);
      assert.ok(both.code.some(hit => path.basename(hit.file) === 'sample.js'));
      assert.equal(both.stats.branchQualification.observed, 'observed-B');
      assert.equal(both.stats.branchQualification.basis, 'current-checkout');
      assert.equal(both.stats.branchQualification.revision, revision);
    }
  } else {
    runGit(['checkout', '--detach', 'HEAD'], { cwd: repoRoot });
    await assert.rejects(withTemporaryEnv(env, () => coreSearch(repoRoot, { query: 'alpha',
      args: ['--mode', 'prose', '--backend', 'memory', '--no-ann', '--branch', 'observed-B'] })), error =>
      error.code === 'CAPABILITY_MISSING' && error.details.branchQualification.reason === 'detached');
    runGit(['checkout', 'observed-B'], { cwd: repoRoot });
    assert.deepEqual(names(await search({ query: 'alpha', args: ['--branch', 'observed-B'] })), expected);
  }
} finally {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(cacheRoot, { recursive: true, force: true });
}
console.log('Current branch search follows checkout changes while indexed branch metrics remain stale.');
