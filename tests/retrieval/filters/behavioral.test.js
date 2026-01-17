#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});

const returns = runSearch({
  fixtureRoot,
  env,
  query: 'update',
  mode: 'code',
  args: ['--returns']
});
if (!(returns.code || []).length) {
  console.error('Search returns filter returned no results.');
  process.exit(1);
}

const asyncPayload = runSearch({
  fixtureRoot,
  env,
  query: 'load',
  mode: 'code',
  args: ['--async']
});
if (!(asyncPayload.code || []).length) {
  console.error('Search async filter returned no results.');
  process.exit(1);
}

console.log('Retrieval behavioral filters ok.');
