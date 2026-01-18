#!/usr/bin/env node
import path from 'node:path';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({ name: 'manifest-hash-fill' });

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
run(
  [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot],
  'build sqlite index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite incremental tests.');
  process.exit(1);
}

const sqlitePaths = ensureSqlitePaths(repoRoot, userConfig);
const db = new Database(sqlitePaths.codePath);
const targetFile = 'src/index.js';
const before = db
  .prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
  .get('code', targetFile);
if (!before) {
  console.error('Missing file_manifest entry for src/index.js.');
  db.close();
  process.exit(1);
}
db.prepare('UPDATE file_manifest SET hash = NULL WHERE mode = ? AND file = ?')
  .run('code', targetFile);
db.close();

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index (incremental)',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
run(
  [path.join(root, 'tools', 'build-sqlite-index.js'), '--incremental', '--repo', repoRoot],
  'build sqlite index (incremental)',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const sqlitePathsAfter = ensureSqlitePaths(repoRoot, userConfig);
const dbAfter = new Database(sqlitePathsAfter.codePath, { readonly: true });
const after = dbAfter
  .prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
  .get('code', targetFile);
dbAfter.close();

if (!after?.hash) {
  console.error('Expected file_manifest hash to be restored after incremental update.');
  process.exit(1);
}

console.log('SQLite incremental manifest hash fill ok.');
