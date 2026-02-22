#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { ensureFixtureIndex, ensureFixtureSqlite } from '../../helpers/fixture-index.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';

applyTestEnv();

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('cli sqlite sparse preflight allow fallback filtered test skipped: better-sqlite3 not available');
  process.exit(0);
}

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'cli-sqlite-sparse-preflight-allow-fallback-filtered',
  cacheScope: 'shared'
});
const sqlitePaths = await ensureFixtureSqlite({ fixtureRoot, userConfig, env });

const db = new Database(sqlitePaths.codePath);
for (const tableName of [
  'token_vocab',
  'token_postings',
  'doc_lengths',
  'token_stats',
  'phrase_vocab',
  'phrase_postings',
  'chargram_vocab',
  'chargram_postings'
]) {
  db.exec(`DROP TABLE IF EXISTS ${tableName}`);
}
db.close();

const baseArgs = [
  'rust_greet',
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--backend',
  'sqlite-fts',
  '--no-ann',
  '--ext',
  '.js',
  '--stats',
  '--json',
  '--compact'
];

let baseFailed = false;
try {
  await runSearchCli(baseArgs, { emitOutput: false, exitOnError: false });
} catch (err) {
  baseFailed = true;
  const message = String(err?.message || err);
  assert.ok(
    /retrieval_sparse_unavailable/i.test(message),
    'expected sparse-unavailable error without fallback override'
  );
}
const payload = await runSearchCli(
  [...baseArgs, '--allow-sparse-fallback'],
  { emitOutput: false, exitOnError: false }
);

assert.equal(baseFailed, true, 'expected filtered sparse-only sqlite-fts run to fail without fallback override');
assert.ok(Array.isArray(payload?.code), 'expected CLI search payload to include code hits');
assert.equal(payload?.stats?.annEnabled, true, 'expected --allow-sparse-fallback to enable ANN preflight for filtered sqlite-fts route with missing BM25 tables');
assert.equal(
  Array.isArray(payload?.stats?.pipeline)
    && payload.stats.pipeline.some((entry) => entry?.stage === 'startup.backend.reinit'),
  true,
  'expected backend context reinit when sparse preflight forces ANN fallback'
);

console.log('cli sqlite sparse preflight allow fallback filtered test passed');
