#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({ name: 'wal-checkpoint' });

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
await runSqliteBuild(repoRoot);

const targetFile = path.join(repoRoot, 'src', 'index.js');
const original = await fsPromises.readFile(targetFile, 'utf8');
await fsPromises.writeFile(targetFile, `${original}\nexport const walCheck = true;\n`);

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index (incremental)',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
await runSqliteBuild(repoRoot, { incremental: true });

const sqlitePaths = ensureSqlitePaths(repoRoot, userConfig);
const walPath = `${sqlitePaths.codePath}-wal`;
const shmPath = `${sqlitePaths.codePath}-shm`;
const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
const shmSize = fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0;
const maxBytes = 1024;
if (walSize > maxBytes) {
  console.error(`Expected WAL to be truncated; size ${walSize} bytes.`);
  process.exit(1);
}
if (shmSize > maxBytes) {
  console.error(`Expected SHM to be truncated; size ${shmSize} bytes.`);
  process.exit(1);
}

console.log('SQLite incremental WAL checkpoint ok.');
