#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-incremental-no-change');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const stripMaxOldSpaceFlag = (options) => {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/--max-old-space-size\s+\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const nodeOptions = stripMaxOldSpaceFlag(process.env.NODE_OPTIONS || '');

const rmWithRetries = async (target, { retries = 8, delayMs = 150 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fsPromises.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!err || attempt >= retries) throw err;
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
};

await rmWithRetries(tempRoot);
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off',
  PAIROFCLEATS_MAX_OLD_SPACE_MB: '4096'
};
if (nodeOptions) {
  env.NODE_OPTIONS = nodeOptions;
} else {
  delete env.NODE_OPTIONS;
}
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
process.env.PAIROFCLEATS_WORKER_POOL = 'off';
process.env.PAIROFCLEATS_MAX_OLD_SPACE_MB = '4096';

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
const initialSqlite = runCapture(
  [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot],
  'build sqlite index'
);
const initialOutput = `${initialSqlite.stdout || ''}\n${initialSqlite.stderr || ''}`;
if (!initialOutput.includes('Validation (smoke) ok for code')) {
  console.error('Expected sqlite smoke validation for code build.');
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
let sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required for sqlite incremental no-change test.');
  process.exit(1);
}

const dbBefore = new Database(sqlitePaths.codePath, { readonly: true });
const beforeCounts = {
  chunks: dbBefore.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code').total,
  files: dbBefore.prepare('SELECT COUNT(*) AS total FROM file_manifest WHERE mode = ?').get('code').total,
  hash: (dbBefore.prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', 'src/index.js') || {}).hash || null
};
dbBefore.close();

const noChangeResult = runCapture(
  [path.join(root, 'tools', 'build-sqlite-index.js'), '--incremental', '--repo', repoRoot],
  'build sqlite index (no change)'
);
const noChangeOutput = `${noChangeResult.stdout || ''}\n${noChangeResult.stderr || ''}`;
if (!noChangeOutput.includes('SQLite indexes updated')) {
  console.error('Expected incremental sqlite update output for no-change run.');
  process.exit(1);
}
if (noChangeOutput.includes('rebuilding full index')) {
  console.error('Expected no full rebuild for no-change run.');
  process.exit(1);
}

sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
const dbAfter = new Database(sqlitePaths.codePath, { readonly: true });
const afterCounts = {
  chunks: dbAfter.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code').total,
  files: dbAfter.prepare('SELECT COUNT(*) AS total FROM file_manifest WHERE mode = ?').get('code').total,
  hash: (dbAfter.prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', 'src/index.js') || {}).hash || null
};
dbAfter.close();

assert.equal(afterCounts.chunks, beforeCounts.chunks, 'expected chunk counts to remain stable');
assert.equal(afterCounts.files, beforeCounts.files, 'expected file manifest counts to remain stable');
assert.equal(afterCounts.hash, beforeCounts.hash, 'expected file manifest hash to remain stable');

console.log('sqlite incremental no-change test passed');
