#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});

const payload = runSearch({
  fixtureRoot,
  env,
  query: 'buildAliases',
  mode: 'code',
  args: ['--file', '/javascript_advanced\\.js$/']
});

const hits = payload.code || [];
if (!hits.length) {
  console.error('Search file selector returned no results.');
  process.exit(1);
}
const hasMatch = hits.some((hit) => hit.file && hit.file.endsWith('javascript_advanced.js'));
if (!hasMatch) {
  console.error('Search file selector did not match javascript_advanced.js.');
  process.exit(1);
}

console.log('Retrieval file selector filter ok.');
