#!/usr/bin/env node
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });

const extScoped = await runSearch({
  query: 'message',
  mode: 'code',
  args: ['--backend', 'memory', '--ext', '.py']
});
const extHits = extScoped.code || [];
if (!extHits.length || extHits.some((hit) => hit.ext !== '.py')) {
  console.error('Fixture ext filter returned unexpected results.');
  process.exit(1);
}

const pathScoped = await runSearch({
  query: 'message',
  mode: 'code',
  args: ['--backend', 'memory', '--path', 'src/sample.py']
});
const pathHits = pathScoped.code || [];
if (!pathHits.length || pathHits.some((hit) => hit.file !== 'src/sample.py')) {
  console.error('Fixture path filter returned unexpected results.');
  process.exit(1);
}

console.log('Fixture ext/path filters ok.');
