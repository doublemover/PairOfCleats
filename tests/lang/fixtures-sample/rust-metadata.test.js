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
  query: 'rust_greet',
  mode: 'code',
  args: ['--backend', 'memory']
});
const hit = (payload.code || []).find(
  (entry) => entry.file === 'src/sample.rs' && entry.name === 'rust_greet'
);
if (!hit) {
  console.error('Rust metadata check failed: missing sample.rs rust_greet chunk.');
  process.exit(1);
}
const signature = hit.docmeta?.signature || '';
if (!signature.includes('fn rust_greet')) {
  console.error('Rust metadata check failed: missing signature metadata.');
  process.exit(1);
}

console.log('Rust fixture metadata ok.');
