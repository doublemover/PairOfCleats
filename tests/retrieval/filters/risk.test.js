#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  requireRiskTags: true
});

const riskTag = runSearch({
  fixtureRoot,
  env,
  query: 'exec',
  mode: 'code',
  args: ['--risk', 'command-exec']
});
if (!(riskTag.code || []).length) {
  console.error('Search risk tag filter returned no results.');
  process.exit(1);
}

const riskFlow = runSearch({
  fixtureRoot,
  env,
  query: 'req',
  mode: 'code',
  args: ['--risk-flow', 'req.body->exec']
});
if (!(riskFlow.code || []).length) {
  console.error('Search risk flow filter returned no results.');
  process.exit(1);
}

console.log('Retrieval risk filters ok.');
