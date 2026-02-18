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
  console.log('cli sqlite sparse preflight missing fts fallback test skipped: better-sqlite3 not available');
  process.exit(0);
}

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'cli-sqlite-sparse-preflight-missing-fts-fallback'
});
const sqlitePaths = await ensureFixtureSqlite({ fixtureRoot, userConfig, env });

const db = new Database(sqlitePaths.prosePath);
db.exec('DROP TABLE IF EXISTS chunks_fts');
db.close();

const payload = await runSearchCli([
  'sample',
  '--repo',
  fixtureRoot,
  '--mode',
  'prose',
  '--backend',
  'sqlite',
  '--no-ann',
  '--stats',
  '--json',
  '--compact'
], {
  emitOutput: false,
  exitOnError: false
});

assert.ok(Array.isArray(payload?.prose), 'expected CLI search payload to include prose hits');
assert.equal(payload?.stats?.annEnabled, false, 'expected ANN to remain disabled for sparse-only BM25 fallback');
assert.equal(
  Array.isArray(payload?.stats?.pipeline)
    && payload.stats.pipeline.some((entry) => entry?.stage === 'startup.backend.reinit'),
  false,
  'did not expect backend context reinit when sparse fallback remains within BM25'
);

console.log('cli sqlite sparse preflight missing fts fallback test passed');
