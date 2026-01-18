#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getExtensionsDir, loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';
import { getBinarySuffix, getPlatformKey } from '../tools/vector-extension.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-ann-extension');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const deletableFile = path.join(repoRoot, 'src', 'ann_deletable.js');
await fsPromises.writeFile(
  deletableFile,
  'export const annDeletable = "ann_deletable_token";\n'
);

const extensionsDir = getExtensionsDir(repoRoot, null);
const extensionPath = path.join(
  extensionsDir,
  'sqlite-vec',
  getPlatformKey(),
  `vec0${getBinarySuffix()}`
);

if (!fs.existsSync(extensionPath)) {
  console.warn(`sqlite ann extension missing; skipping test (${extensionPath})`);
  process.exit(0);
}

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_BUNDLE_THREADS: '1'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
process.env.PAIROFCLEATS_BUNDLE_THREADS = '1';

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

run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot], 'build sqlite index');

const userConfig = loadUserConfig(repoRoot);
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite-ann-extension test.');
  process.exit(1);
}

const db = new Database(sqlitePaths.codePath, { readonly: true });
try {
  db.loadExtension(extensionPath);
} catch (err) {
  console.error(`Failed to load sqlite ann extension for verification: ${err?.message || err}`);
  process.exit(1);
}
const table = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
).get('dense_vectors_ann');
if (!table) {
  console.error('sqlite ann extension table missing: dense_vectors_ann');
  process.exit(1);
}
const countRow = db.prepare('SELECT COUNT(*) AS count FROM dense_vectors_ann').get();
if (!countRow?.count) {
  console.error('sqlite ann extension table empty: dense_vectors_ann');
  process.exit(1);
}
const denseCountBefore = db.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors WHERE mode = ?'
).get('code');
const annCountBefore = countRow.count;
db.close();

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'index', '--json', '--ann', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for sqlite ann extension test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'sqlite-extension') {
  console.error(`Expected annBackend=sqlite-extension, got ${stats.annBackend}`);
  process.exit(1);
}
if (stats.annMode !== 'extension') {
  console.error(`Expected annMode=extension, got ${stats.annMode}`);
  process.exit(1);
}
if (!stats.annExtension?.available?.code) {
  console.error('Expected sqlite ann extension available for code.');
  process.exit(1);
}

await fsPromises.rm(deletableFile, { force: true });
run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index (incremental)');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--incremental', '--mode', 'code', '--repo', repoRoot], 'build sqlite index (incremental)');

const sqlitePathsAfter = resolveSqlitePaths(repoRoot, userConfig);
const dbAfter = new Database(sqlitePathsAfter.codePath, { readonly: true });
try {
  dbAfter.loadExtension(extensionPath);
} catch (err) {
  console.error(`Failed to load sqlite ann extension for incremental verification: ${err?.message || err}`);
  process.exit(1);
}
const denseCountAfter = dbAfter.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors WHERE mode = ?'
).get('code');
const annCountAfter = dbAfter.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors_ann'
).get()?.count;
if (Number(annCountAfter) !== Number(denseCountAfter?.count)) {
  console.error(`Dense vector count mismatch after incremental update: dense=${denseCountAfter?.count} ann=${annCountAfter}`);
  process.exit(1);
}
if (denseCountBefore?.count && denseCountAfter?.count >= denseCountBefore.count) {
  console.error('Expected dense vector count to drop after deletion.');
  process.exit(1);
}
const orphanRow = dbAfter.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors_ann WHERE rowid NOT IN (SELECT doc_id FROM dense_vectors WHERE mode = ?)'
).get('code');
if (orphanRow?.count) {
  console.error(`Found ${orphanRow.count} orphaned ann rows after deletion.`);
  process.exit(1);
}
dbAfter.close();

console.log('sqlite ann extension test passed');
