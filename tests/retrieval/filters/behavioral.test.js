#!/usr/bin/env node
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });

const returns = await runSearch({
  query: 'update',
  mode: 'code',
  args: ['--returns']
});
if (!(returns.code || []).length) {
  console.error('Search returns filter returned no results.');
  process.exit(1);
}

const asyncPayload = await runSearch({
  query: 'load',
  mode: 'code',
  args: ['--async']
});
if (!(asyncPayload.code || []).length) {
  console.error('Search async filter returned no results.');
  process.exit(1);
}

console.log('Retrieval behavioral filters ok.');
