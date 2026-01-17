#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const negativeToken = runFilterSearch({ repoRoot, env, query: 'alpha -gamma' });
const negativeTokenFiles = extractFiles(negativeToken);
if (!negativeTokenFiles.has('alpha.txt') || negativeTokenFiles.has('beta.txt')) {
  console.error('Negative token filter failed.');
  process.exit(1);
}

const negativePhrase = runFilterSearch({ repoRoot, env, query: 'alpha -"alpha beta"' });
const negativePhraseFiles = extractFiles(negativePhrase);
if (!negativePhraseFiles.has('beta.txt') || negativePhraseFiles.has('alpha.txt')) {
  console.error('Negative phrase filter failed.');
  process.exit(1);
}

console.log('Query syntax negative terms ok.');
