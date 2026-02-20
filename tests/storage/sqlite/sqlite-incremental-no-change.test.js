#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'sqlite-incremental-no-change');
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

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_MAX_OLD_SPACE_MB: '4096'
  }
});

const env = {
  ...process.env
};
if (nodeOptions) {
  env.NODE_OPTIONS = nodeOptions;
} else {
  delete env.NODE_OPTIONS;
}
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
const initialLogs = [];
await runSqliteBuild(repoRoot, {
  logger: {
    log: (message) => initialLogs.push(message),
    warn: (message) => initialLogs.push(message),
    error: (message) => initialLogs.push(message)
  }
});
getCombinedOutput({ stdout: initialLogs.join('\n'), stderr: '' });

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
const codeIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const statePath = path.join(codeIndexDir, 'index_state.json');
const stateBefore = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));

const noChangeLogs = [];
await runSqliteBuild(repoRoot, {
  incremental: true,
  logger: {
    log: (message) => noChangeLogs.push(message),
    warn: (message) => noChangeLogs.push(message),
    error: (message) => noChangeLogs.push(message)
  }
});
const noChangeOutput = getCombinedOutput({ stdout: noChangeLogs.join('\n'), stderr: '' });
if (!noChangeOutput.toLowerCase().includes('sqlite indexes updated')) {
  console.error('Expected incremental sqlite update output for no-change run.');
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
const stateAfter = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
if (stateBefore?.sqlite) {
  assert.equal(stateAfter.sqlite?.ready, stateBefore.sqlite.ready, 'expected sqlite ready to remain stable');
  assert.equal(stateAfter.sqlite?.pending, stateBefore.sqlite.pending, 'expected sqlite pending to remain stable');
}

assert.equal(afterCounts.chunks, beforeCounts.chunks, 'expected chunk counts to remain stable');
assert.equal(afterCounts.files, beforeCounts.files, 'expected file manifest counts to remain stable');
assert.equal(afterCounts.hash, beforeCounts.hash, 'expected file manifest hash to remain stable');

console.log('sqlite incremental no-change test passed');


