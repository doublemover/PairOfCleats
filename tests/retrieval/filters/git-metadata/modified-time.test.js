#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const dayMs = 24 * 60 * 60 * 1000;
const now = Date.now();
const cutoff = new Date(now - 2 * dayMs).toISOString();

const modifiedAfter = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--modified-after', cutoff]
});
const modifiedAfterFiles = extractFiles(modifiedAfter);
if (!modifiedAfterFiles.has('beta.txt') || modifiedAfterFiles.has('alpha.txt')) {
  console.error('modified-after filter failed.');
  process.exit(1);
}

const modifiedSince = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--modified-since', '2']
});
const modifiedSinceFiles = extractFiles(modifiedSince);
if (!modifiedSinceFiles.has('beta.txt') || modifiedSinceFiles.has('alpha.txt')) {
  console.error('modified-since filter failed.');
  process.exit(1);
}

console.log('Git metadata modified-time filters ok.');
