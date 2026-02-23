#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import {
  getIndexDir,
  getRepoCacheRoot,
  loadUserConfig,
  resolveSqlitePaths
} from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { rmDirRecursive } from '../../helpers/temp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'sqlite-incremental-no-change');
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

run([
  path.join(root, 'build_index.js'),
  '--incremental',
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--stage',
  'stage2',
  '--no-sqlite',
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'build code index');
const initialLogs = [];
await runSqliteBuild(repoRoot, {
  mode: 'code',
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
  mode: 'code',
  incremental: true,
  logger: {
    log: (message) => noChangeLogs.push(message),
    warn: (message) => noChangeLogs.push(message),
    error: (message) => noChangeLogs.push(message)
  }
});
const noChangeOutput = getCombinedOutput({ stdout: noChangeLogs.join('\n'), stderr: '' });
if (!noChangeOutput.toLowerCase().includes('incremental update applied')) {
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

const triageFixturePath = path.join(root, 'tests', 'fixtures', 'triage', 'generic.json');
run([
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source',
  'generic',
  '--in',
  triageFixturePath,
  '--repo',
  repoRoot,
  '--meta',
  'service=api',
  '--meta',
  'env=prod'
], 'ingest generic records');
run([
  path.join(root, 'build_index.js'),
  '--incremental',
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--stage',
  'stage2',
  '--no-sqlite',
  '--mode',
  'records',
  '--repo',
  repoRoot
], 'build records index');

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const recordsManifestPath = path.join(repoCacheRoot, 'incremental', 'records', 'manifest.json');
const recordsManifest = JSON.parse(await fsPromises.readFile(recordsManifestPath, 'utf8'));
assert.equal(
  recordsManifest.bundleRecordsIncremental,
  true,
  'expected records incremental manifest capability bit'
);
assert.ok(
  Object.keys(recordsManifest.files || {}).length > 0,
  'expected non-empty records incremental manifest'
);

const recordsInitialLogs = [];
await runSqliteBuild(repoRoot, {
  mode: 'records',
  incremental: true,
  logger: {
    log: (message) => recordsInitialLogs.push(message),
    warn: (message) => recordsInitialLogs.push(message),
    error: (message) => recordsInitialLogs.push(message)
  }
});
const recordsInitialOutput = getCombinedOutput({ stdout: recordsInitialLogs.join('\n'), stderr: '' });
const recordsInitialOutputLower = recordsInitialOutput.toLowerCase();
if (!recordsInitialOutput.includes('Using incremental bundles for records')) {
  console.error('Expected first records sqlite build to use incremental bundles.');
  process.exit(1);
}
if (
  recordsInitialOutputLower.includes('incremental bundles skipped for records')
  || recordsInitialOutputLower.includes('using artifacts')
) {
  console.error('Did not expect records sqlite incremental bundle fallback on supported manifest.');
  process.exit(1);
}

sqlitePaths = resolveSqlitePaths(repoRoot, userConfig, { mode: 'records' });
const recordsDbBefore = new Database(sqlitePaths.recordsPath, { readonly: true });
const recordsBefore = recordsDbBefore
  .prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
  .get('records').total;
recordsDbBefore.close();
assert.ok(recordsBefore > 0, 'expected records sqlite build to contain records chunks');

const recordsNoChangeLogs = [];
await runSqliteBuild(repoRoot, {
  mode: 'records',
  incremental: true,
  logger: {
    log: (message) => recordsNoChangeLogs.push(message),
    warn: (message) => recordsNoChangeLogs.push(message),
    error: (message) => recordsNoChangeLogs.push(message)
  }
});
const recordsNoChangeOutput = getCombinedOutput({ stdout: recordsNoChangeLogs.join('\n'), stderr: '' });
const recordsNoChangeOutputLower = recordsNoChangeOutput.toLowerCase();
if (!recordsNoChangeOutputLower.includes('incremental update applied')) {
  console.error('Expected records no-change sqlite build to use incremental update.');
  process.exit(1);
}
if (
  recordsNoChangeOutputLower.includes('incremental bundles skipped for records')
  || recordsNoChangeOutputLower.includes('using artifacts')
) {
  console.error('Did not expect records no-change sqlite build fallback on supported manifest.');
  process.exit(1);
}
const recordsDbAfter = new Database(sqlitePaths.recordsPath, { readonly: true });
const recordsAfter = recordsDbAfter
  .prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
  .get('records').total;
recordsDbAfter.close();
assert.equal(recordsAfter, recordsBefore, 'expected records chunk counts to remain stable');

console.log('sqlite incremental no-change test passed');


