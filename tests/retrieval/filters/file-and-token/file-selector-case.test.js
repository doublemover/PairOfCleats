#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const caseInsensitive = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--file', 'casefile.txt']
});
if (!extractFiles(caseInsensitive).has('CaseFile.TXT')) {
  console.error('case-insensitive file filter failed.');
  process.exit(1);
}

const caseSensitive = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--file', 'casefile.txt', '--case-file']
});
if (extractFiles(caseSensitive).has('CaseFile.TXT')) {
  console.error('case-sensitive file filter should not match.');
  process.exit(1);
}

const regexFile = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--file', '/casefile\\.txt/']
});
if (!extractFiles(regexFile).has('CaseFile.TXT')) {
  console.error('regex file filter failed.');
  process.exit(1);
}

console.log('File selector case sensitivity ok.');
