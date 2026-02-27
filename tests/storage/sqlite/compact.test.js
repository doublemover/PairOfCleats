#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'sqlite-compact');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const deletableFile = path.join(repoRoot, 'src', 'deletable.js');
const renameFile = path.join(repoRoot, 'src', 'rename_me.js');
await fsPromises.writeFile(
  deletableFile,
  'export const xqzflorb = "xqzflorb";\n'
);
await fsPromises.writeFile(
  renameFile,
  'export function renameToken() { return "renametoken"; }\n'
);

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

run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index');
await runSqliteBuild(repoRoot);

const renamedFile = path.join(repoRoot, 'src', 'renamed.js');
await fsPromises.rm(deletableFile, { force: true });
await fsPromises.rename(renameFile, renamedFile);

run([path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot], 'build index (incremental)');
await runSqliteBuild(repoRoot, { incremental: true });
run([path.join(root, 'tools', 'build', 'compact-sqlite-index.js'), '--repo', repoRoot], 'compact sqlite index');

const userConfig = loadUserConfig(repoRoot);
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite-compact test.');
  process.exit(1);
}

const db = new Database(sqlitePaths.codePath, { readonly: true });
const stats = db.prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?').get('code') || {};
const total = Number(stats.total) || 0;
const maxId = Number(stats.maxId);
if (total && maxId !== total - 1) {
  console.error(`Compaction failed: expected maxId=${total - 1} got ${maxId}`);
  process.exit(1);
}

const oldFile = db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode = ? AND file = ?').get('code', 'src/rename_me.js');
if (oldFile?.count) {
  console.error('Compaction failed: old file name still present.');
  process.exit(1);
}

const manifestOld = db.prepare('SELECT COUNT(*) AS count FROM file_manifest WHERE mode = ? AND file = ?').get('code', 'src/rename_me.js');
if (manifestOld?.count) {
  console.error('Compaction failed: old file name still in file_manifest.');
  process.exit(1);
}

const manifestNew = db.prepare('SELECT COUNT(*) AS count FROM file_manifest WHERE mode = ? AND file = ?').get('code', 'src/renamed.js');
if (!manifestNew?.count) {
  console.error('Compaction failed: renamed file missing from file_manifest.');
  process.exit(1);
}

const vocabHit = db.prepare('SELECT COUNT(*) AS count FROM token_vocab WHERE mode = ? AND token = ?').get('code', 'xqzflorb');
if (vocabHit?.count) {
  console.error('Compaction failed: deleted token still in vocab.');
  process.exit(1);
}

db.close();
console.log('SQLite compaction test passed');

