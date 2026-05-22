import assert from 'node:assert/strict';

import { runSearchCli } from '../../../src/retrieval/cli.js';
import { ensureFixtureIndex, ensureFixtureSqlite } from '../../helpers/fixture-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const SPARSE_TABLES = Object.freeze([
  'token_vocab',
  'token_postings',
  'doc_lengths',
  'token_stats',
  'phrase_vocab',
  'phrase_postings',
  'chargram_vocab',
  'chargram_postings'
]);

export async function prepareSparsePreflightFallbackCase({
  label,
  cacheName,
  extraArgs = []
}) {
  applyTestEnv();

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    console.log(`${label} skipped: better-sqlite3 not available`);
    process.exit(0);
  }

  const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
    fixtureName: 'sample',
    cacheName,
    cacheScope: 'shared'
  });
  const sqlitePaths = await ensureFixtureSqlite({ fixtureRoot, userConfig, env });

  const db = new Database(sqlitePaths.codePath);
  for (const tableName of SPARSE_TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
  }
  db.close();

  return [
    'rust_greet',
    '--repo',
    fixtureRoot,
    '--mode',
    'code',
    '--backend',
    'sqlite-fts',
    '--no-ann',
    ...extraArgs,
    '--stats',
    '--json',
    '--compact'
  ];
}

export async function assertSparsePreflightFallback({
  baseArgs,
  failMessage,
  annMessage
}) {
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

  assert.equal(baseFailed, true, failMessage);
  assert.ok(Array.isArray(payload?.code), 'expected CLI search payload to include code hits');
  assert.equal(payload?.stats?.annEnabled, true, annMessage);
  assert.equal(
    Array.isArray(payload?.stats?.pipeline)
      && payload.stats.pipeline.some((entry) => entry?.stage === 'startup.backend.reinit'),
    true,
    'expected backend context reinit when sparse preflight forces ANN fallback'
  );
}
