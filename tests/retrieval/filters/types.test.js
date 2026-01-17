#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});

const inferred = runSearch({
  fixtureRoot,
  env,
  query: 'makeWidget',
  mode: 'code',
  args: ['--inferred-type', 'object']
});
if (!(inferred.code || []).length) {
  console.error('Search inferred-type filter returned no results.');
  process.exit(1);
}

const returns = runSearch({
  fixtureRoot,
  env,
  query: 'makeWidget',
  mode: 'code',
  args: ['--return-type', 'Widget']
});
if (!(returns.code || []).length) {
  console.error('Search return-type filter returned no results.');
  process.exit(1);
}

console.log('Retrieval type filters ok.');
