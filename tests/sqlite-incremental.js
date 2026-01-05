#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';
import { SCHEMA_VERSION } from '../src/storage/sqlite/schema.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-incremental');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function runCapture(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
}

run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot], 'build sqlite index');

const userConfig = loadUserConfig(repoRoot);
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required for sqlite-incremental test.');
  process.exit(1);
}

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

run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index (incremental)');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--incremental', '--repo', repoRoot], 'build sqlite index (incremental)');

const dbAfter = new Database(sqlitePaths.codePath, { readonly: true });
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

const downgradeVersion = Math.max(0, SCHEMA_VERSION - 1);
const dbDowngrade = new Database(sqlitePaths.codePath);
dbDowngrade.pragma(`user_version = ${downgradeVersion}`);
dbDowngrade.close();

const rebuildResult = runCapture(
  [path.join(root, 'tools', 'build-sqlite-index.js'), '--incremental', '--repo', repoRoot],
  'build sqlite index (schema mismatch)'
);
const rebuildOutput = `${rebuildResult.stdout || ''}\n${rebuildResult.stderr || ''}`;
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

console.log('SQLite incremental test passed');
