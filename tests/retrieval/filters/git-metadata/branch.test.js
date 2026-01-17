#!/usr/bin/env node
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env, branchName } = context;
if (!branchName) {
  console.log('Skipping branch filter test (branch name unavailable).');
  process.exit(0);
}

const branchMatch = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--branch', branchName]
});
if (!(branchMatch.prose || []).length) {
  console.error('branch filter returned no results for current branch.');
  process.exit(1);
}

const branchMiss = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--branch', 'no-such-branch']
});
if ((branchMiss.prose || []).length) {
  console.error('branch mismatch should return no results.');
  process.exit(1);
}

console.log('Git metadata branch filter ok.');
