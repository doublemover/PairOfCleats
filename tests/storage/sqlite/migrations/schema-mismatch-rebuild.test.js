#!/usr/bin/env node
import path from 'node:path';
import { SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';
import { getCombinedOutput } from '../../../helpers/stdio.js';

const { root, repoRoot, env, userConfig, run, runCapture } = await setupIncrementalRepo({
  name: 'schema-mismatch-rebuild'
});

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
run(
  [path.join(root, 'tools', 'build/sqlite-index.js'), '--repo', repoRoot],
  'build sqlite index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

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

const rebuildResult = runCapture(
  [path.join(root, 'tools', 'build/sqlite-index.js'), '--incremental', '--repo', repoRoot],
  'build sqlite index (schema mismatch)'
);
const rebuildOutput = getCombinedOutput(rebuildResult);
if (!rebuildOutput.includes('schema mismatch')) {
  console.error('Expected schema mismatch rebuild warning for incremental sqlite update.');
  process.exit(1);
}

const dbRebuilt = new Database(sqlitePaths.codePath, { readonly: true });
const rebuiltVersion = dbRebuilt.pragma('user_version', { simple: true });
dbRebuilt.close();
if (rebuiltVersion !== SCHEMA_VERSION) {
  console.error(`Expected schema version ${SCHEMA_VERSION}, got ${rebuiltVersion}.`);
  process.exit(1);
}

console.log('SQLite schema mismatch rebuild ok.');
