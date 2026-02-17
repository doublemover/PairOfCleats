#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureFixtureIndex, ensureFixtureSqlite } from '../../helpers/fixture-index.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';

process.env.PAIROFCLEATS_TESTING = '1';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('cli sqlite sparse preflight allow fallback test skipped: better-sqlite3 not available');
  process.exit(0);
}

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'cli-sqlite-sparse-preflight-allow-fallback'
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
  'alpha',
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--backend',
  'sqlite-fts',
  '--no-ann',
  '--stats',
  '--json',
  '--compact'
];

await assert.rejects(
  () => runSearchCli(baseArgs, { emitOutput: false, exitOnError: false }),
  /retrieval_sparse_unavailable/i,
  'expected sparse-only sqlite preflight to reject when sparse tables are missing'
);

const payload = await runSearchCli(
  [...baseArgs, '--allow-sparse-fallback'],
  { emitOutput: false, exitOnError: false }
);

assert.ok(Array.isArray(payload?.code), 'expected CLI search payload to include code hits');
assert.equal(payload?.stats?.annEnabled, true, 'expected sparse fallback preflight to enable ANN');
assert.equal(
  payload?.stats?.capabilities?.ann?.extensionEnabled,
  true,
  'expected ANN extension capability flag to be recomputed after sparse fallback preflight'
);
assert.equal(
  Array.isArray(payload?.stats?.pipeline)
    && payload.stats.pipeline.some((entry) => entry?.stage === 'startup.backend.reinit'),
  true,
  'expected backend context to be reinitialized after sparse fallback preflight enables ANN'
);

console.log('cli sqlite sparse preflight allow fallback test passed');
