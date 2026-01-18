#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, run } = await setupIncrementalRepo({ name: 'search-after-update' });

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

const targetFile = path.join(repoRoot, 'src', 'index.js');
const original = await fsPromises.readFile(targetFile, 'utf8');
const updated = `${original}\nexport function farewell(name) {\n  return \`bye \${name}\`;\n}\n`;
await fsPromises.writeFile(targetFile, updated);

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

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'farewell', '--json', '--backend', 'sqlite-fts', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('Search failed after incremental update.');
  process.exit(searchResult.status ?? 1);
}
const payload = JSON.parse(searchResult.stdout || '{}');
if (!payload.code?.length && !payload.prose?.length) {
  console.error('Incremental sqlite update produced no search results.');
  process.exit(1);
}

console.log('SQLite incremental search after update ok.');
