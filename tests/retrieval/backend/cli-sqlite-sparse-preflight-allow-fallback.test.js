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
  'rust_greet',
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

const basePayload = await runSearchCli(baseArgs, { emitOutput: false, exitOnError: false });

const payload = await runSearchCli(
  [...baseArgs, '--allow-sparse-fallback'],
  { emitOutput: false, exitOnError: false }
);

assert.ok(Array.isArray(basePayload?.code), 'expected CLI search payload to include code hits');
assert.ok(Array.isArray(payload?.code), 'expected CLI search payload to include code hits');
assert.equal(basePayload?.stats?.annEnabled, false, 'expected ANN to remain disabled for healthy sqlite-fts route');
assert.equal(payload?.stats?.annEnabled, false, 'expected --allow-sparse-fallback to remain a no-op for healthy sqlite-fts route');
assert.equal(
  payload?.stats?.capabilities?.ann?.extensionEnabled,
  false,
  'expected ANN extension capability to remain disabled when ANN fallback is not activated'
);
assert.equal(
  Array.isArray(payload?.stats?.pipeline)
    && payload.stats.pipeline.some((entry) => entry?.stage === 'startup.backend.reinit'),
  false,
  'did not expect backend context reinit when sqlite-fts can satisfy sparse retrieval'
);

console.log('cli sqlite sparse preflight allow fallback test passed');
