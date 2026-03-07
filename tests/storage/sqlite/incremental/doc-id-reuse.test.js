#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({ name: 'doc-id-reuse' });

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
await runSqliteBuild(repoRoot);

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
const beforeStats = dbBefore
  .prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?')
  .get('code');
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
await runSqliteBuild(repoRoot, { mode: 'code', incremental: true });

const sqlitePathsAfter = ensureSqlitePaths(repoRoot, userConfig);
const dbAfter = new Database(sqlitePathsAfter.codePath, { readonly: true });
const newIds = dbAfter
  .prepare('SELECT id FROM chunks WHERE mode = ? AND (file = ? OR file = ?) ORDER BY id')
  .all('code', 'src/new-file.js', 'src\\new-file.js')
  .map((row) => row.id);
const removedRows = dbAfter
  .prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode = ? AND file = ?')
  .get('code', 'src/util.js');
const afterStats = dbAfter
  .prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?')
  .get('code');
dbAfter.close();

if (!newIds.length) {
  console.error('Expected doc ids for src/new-file.js after incremental update.');
  process.exit(1);
}
if (Number(removedRows?.count || 0) !== 0) {
  console.error('Expected src/util.js rows to be removed after incremental update.');
  process.exit(1);
}
if (!Number.isFinite(Number(beforeStats?.maxId)) || !Number.isFinite(Number(afterStats?.maxId))) {
  console.error('Expected valid max doc ids before/after incremental update.');
  process.exit(1);
}
if (Number(afterStats.maxId) > Number(beforeStats.maxId)) {
  console.error(
    `Expected doc id reuse (no id growth) after incremental update; before max=${beforeStats.maxId}, after max=${afterStats.maxId}.`
  );
  process.exit(1);
}
console.log('SQLite incremental doc-id reuse ok.');
