#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key) =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const punctuationSearch = runFilterSearch({
  repoRoot,
  env,
  query: '&&',
  mode: 'code'
});
if (!extractFiles(punctuationSearch, 'code').has('sample.js')) {
  console.error('punctuation token match failed.');
  process.exit(1);
}

console.log('Punctuation tokenization ok.');
