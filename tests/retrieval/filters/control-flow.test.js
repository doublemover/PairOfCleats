#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});

const payload = runSearch({
  fixtureRoot,
  env,
  query: 'load',
  mode: 'code',
  args: ['--branches', '1']
});

const hits = payload.code || [];
if (!hits.length) {
  console.error('Search branches filter returned no results.');
  process.exit(1);
}
const hasBranches = hits.some((hit) => (hit.docmeta?.controlFlow?.branches || 0) >= 1);
if (!hasBranches) {
  console.error('Search branches filter missing controlFlow.branches metadata.');
  process.exit(1);
}

console.log('Retrieval control-flow filter ok.');
