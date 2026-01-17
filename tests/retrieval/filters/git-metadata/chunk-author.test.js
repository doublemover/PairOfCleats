#!/usr/bin/env node
import path from 'node:path';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const chunkAuthorAlice = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--chunk-author', 'Alice']
});
const aliceFiles = extractFiles(chunkAuthorAlice);
if (!aliceFiles.has('alpha.txt') || aliceFiles.has('beta.txt')) {
  console.error('Chunk author filter for Alice failed.');
  process.exit(1);
}

const chunkAuthorBob = runFilterSearch({
  repoRoot,
  env,
  query: 'alpha',
  args: ['--chunk-author', 'Bob']
});
const bobFiles = extractFiles(chunkAuthorBob);
if (!bobFiles.has('beta.txt') || bobFiles.has('alpha.txt')) {
  console.error('Chunk author filter for Bob failed.');
  process.exit(1);
}

console.log('Git metadata chunk author filter ok.');
