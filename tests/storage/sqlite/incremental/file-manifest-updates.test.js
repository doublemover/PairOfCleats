#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({ name: 'file-manifest-updates' });

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
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
const beforeRow = dbBefore
  .prepare('SELECT hash, chunk_count FROM file_manifest WHERE mode = ? AND file = ?')
  .get('code', 'src/index.js');
dbBefore.close();
if (!beforeRow) {
  console.error('Missing file_manifest entry for src/index.js');
  process.exit(1);
}

const targetFile = path.join(repoRoot, 'src', 'index.js');
const original = await fsPromises.readFile(targetFile, 'utf8');
const updated = `${original}\nexport function farewell(name) {\n  return \`bye \${name}\`;\n}\n`;
await fsPromises.writeFile(targetFile, updated);

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
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
const afterRow = dbAfter
  .prepare('SELECT hash, chunk_count FROM file_manifest WHERE mode = ? AND file = ?')
  .get('code', 'src/index.js');
dbAfter.close();

if (!afterRow) {
  console.error('Missing file_manifest entry after incremental update.');
  process.exit(1);
}
if (beforeRow.hash && afterRow.hash && beforeRow.hash === afterRow.hash) {
  console.error('file_manifest hash did not update after incremental change.');
  process.exit(1);
}
if (!afterRow.chunk_count) {
  console.error('file_manifest chunk_count missing after incremental update.');
  process.exit(1);
}

console.log('SQLite incremental file manifest updates ok.');
