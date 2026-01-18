#!/usr/bin/env node
import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;

const phraseSearch = runFilterSearch({
  repoRoot,
  env,
  query: '"alpha beta"',
  args: ['--explain']
});
const phraseHits = phraseSearch.prose || [];
if (!phraseHits.length) {
  console.error('Phrase search returned no results.');
  process.exit(1);
}
const phraseMatch = phraseHits[0]?.scoreBreakdown?.phrase?.matches || 0;
if (phraseMatch <= 0) {
  console.error('Expected phrase match score breakdown for quoted phrase.');
  process.exit(1);
}

console.log('Query syntax phrase breakdown ok.');
