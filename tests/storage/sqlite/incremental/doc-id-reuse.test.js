#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({ name: 'doc-id-reuse' });

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
const dbBefore = new Database(sqlitePaths.codePath, { readonly: true });
const deletedIds = dbBefore
  .prepare('SELECT id FROM chunks WHERE mode = ? AND file = ? ORDER BY id')
  .all('code', 'src/util.js')
  .map((row) => row.id);
dbBefore.close();

if (!deletedIds.length) {
  console.error('Expected at least one doc id for src/util.js.');
  process.exit(1);
}

await fsPromises.rm(path.join(repoRoot, 'src', 'util.js'));
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'new-file.js'),
  'export const meaning = 42;\n'
);

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
const newIds = dbAfter
  .prepare('SELECT id FROM chunks WHERE mode = ? AND file = ? ORDER BY id')
  .all('code', 'src/new-file.js')
  .map((row) => row.id);
dbAfter.close();

if (!newIds.length) {
  console.error('Expected doc ids for src/new-file.js after incremental update.');
  process.exit(1);
}

const deletedSet = new Set(deletedIds);
const reused = newIds.every((id) => deletedSet.has(id));
if (!reused) {
  console.error(`Expected doc ids for new file to reuse deleted ids; got: ${newIds.join(', ')}`);
  process.exit(1);
}

console.log('SQLite incremental doc-id reuse ok.');
