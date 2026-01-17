#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const caseInsensitiveToken = runFilterSearch({
  repoRoot,
  env,
  query: 'AlphaCase'
});
if (!extractFiles(caseInsensitiveToken).has('CaseFile.TXT')) {
  console.error('case-insensitive token match failed.');
  process.exit(1);
}

const caseSensitiveToken = runFilterSearch({
  repoRoot,
  env,
  query: 'AlphaCase',
  args: ['--case-tokens']
});
if (extractFiles(caseSensitiveToken).has('CaseFile.TXT')) {
  console.error('case-sensitive token match should not match.');
  process.exit(1);
}

console.log('Token case sensitivity ok.');
