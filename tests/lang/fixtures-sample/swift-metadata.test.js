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
  query: 'sayHello',
  mode: 'code',
  args: ['--backend', 'memory']
});
const hit = (payload.code || []).find(
  (entry) => entry.file === 'src/sample.swift' && entry.name === 'Greeter.sayHello'
);
if (!hit) {
  console.error('Swift metadata check failed: missing sample.swift sayHello chunk.');
  process.exit(1);
}
const signature = hit.docmeta?.signature || '';
const decorators = hit.docmeta?.decorators || [];
if (!signature.includes('func sayHello')) {
  console.error('Swift metadata check failed: missing signature metadata.');
  process.exit(1);
}
if (!decorators.includes('available')) {
  console.error('Swift metadata check failed: missing attribute metadata.');
  process.exit(1);
}

console.log('Swift fixture metadata ok.');
