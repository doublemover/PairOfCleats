#!/usr/bin/env node
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });

const payload = await runSearch({
  query: 'message',
  mode: 'code',
  args: ['--explain']
});
const hit = (payload.code || [])[0];
if (!hit) {
  console.error('Result shape test returned no hits.');
  process.exit(1);
}
if (typeof hit.score !== 'number' || !hit.scoreType) {
  console.error('Result shape missing score or scoreType.');
  process.exit(1);
}
const breakdown = hit.scoreBreakdown || {};
if (!breakdown.selected) {
  console.error('Result shape missing scoreBreakdown.selected.');
  process.exit(1);
}

console.log('Retrieval result shape ok.');
