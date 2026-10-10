#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

const { root, repoRoot, env, userConfig, run, runCapture } = await setupIncrementalRepo({
  name: 'schema-mismatch-rebuild'
});

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
await runSqliteBuild(repoRoot, { mode: 'code' });

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite migration tests.');
  process.exit(1);
}

const sqlitePaths = ensureSqlitePaths(repoRoot, userConfig);
const downgradeVersion = Math.max(0, SCHEMA_VERSION - 1);
const dbDowngrade = new Database(sqlitePaths.codePath);
dbDowngrade.pragma(`user_version = ${downgradeVersion}`);
dbDowngrade.close();

// Unsupported formats must fail closed before any database mutation.
const databaseBefore = await fs.readFile(sqlitePaths.codePath);
await assert.rejects(
  runSqliteBuild(repoRoot, { mode: 'code', incremental: true }),
  (error) => {
    assert.equal(error.code, 'ERR_INDEX_FORMAT_UNSUPPORTED');
    assert.match(error.message, /SQLite schema/);
    assert.match(error.message, /pairofcleats index build/);
    return true;
  }
);
assert.deepEqual(await fs.readFile(sqlitePaths.codePath), databaseBefore);
const dbPreserved = new Database(sqlitePaths.codePath, { readonly: true });
assert.equal(dbPreserved.pragma('user_version', { simple: true }), downgradeVersion);
dbPreserved.close();

console.log('SQLite schema mismatch fails closed and preserves the database.');
