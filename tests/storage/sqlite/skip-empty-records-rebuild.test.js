#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSqliteIndex } from '../../../tools/build/sqlite/runner.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { setRecordsIncrementalCapability } from '../../../src/storage/sqlite/build/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite empty records rebuild test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-skip-empty-records-rebuild');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildRoot = path.join(tempRoot, 'build-root');
const recordsIndexDir = path.join(buildRoot, 'index-records');
const sqliteDir = path.join(buildRoot, 'index-sqlite');
const outputPath = path.join(sqliteDir, 'index-records.db');
const zeroStateManifestPath = path.join(recordsIndexDir, 'pieces', 'sqlite-zero-state.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(recordsIndexDir, { recursive: true });
await fs.mkdir(sqliteDir, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'src', 'placeholder.js'), 'export const x = 1;\n', 'utf8');

applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: { enabled: false }
    }
  }
});

await fs.writeFile(path.join(recordsIndexDir, 'chunk_meta.json'), '[]\n', 'utf8');
const logs = [];
await buildSqliteIndex({
  root: repoRoot,
  mode: 'records',
  indexRoot: buildRoot,
  out: outputPath,
  recordsDir: recordsIndexDir,
  emitOutput: true,
  logger: {
    log: (message) => logs.push(String(message || '')),
    warn: (message) => logs.push(String(message || '')),
    error: (message) => logs.push(String(message || ''))
  },
  exitOnError: false
});

assert.equal(
  await fs.access(outputPath).then(() => true).catch(() => false),
  false,
  'expected first-run empty records sqlite build to skip creating db'
);
assert.equal(
  await fs.access(zeroStateManifestPath).then(() => true).catch(() => false),
  true,
  'expected zero-state manifest for empty records mode'
);
assert.equal(
  logs.some((line) => line.includes('skipping records sqlite rebuild (artifacts empty; zero-state).')),
  true,
  'expected zero-state skip log for empty records rebuild'
);

const seedDb = new Database(outputPath);
seedDb.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, mode TEXT NOT NULL);');
seedDb.close();
const before = await fs.stat(outputPath);
const secondRunLogs = [];
await buildSqliteIndex({
  root: repoRoot,
  mode: 'records',
  indexRoot: buildRoot,
  out: outputPath,
  recordsDir: recordsIndexDir,
  emitOutput: true,
  logger: {
    log: (message) => secondRunLogs.push(String(message || '')),
    warn: (message) => secondRunLogs.push(String(message || '')),
    error: (message) => secondRunLogs.push(String(message || ''))
  },
  exitOnError: false
});
const after = await fs.stat(outputPath);

assert.equal(after.mtimeMs, before.mtimeMs, 'expected empty records sqlite db to remain unchanged');
assert.equal(
  secondRunLogs.some((line) => line.includes('skipping records sqlite rebuild (artifacts empty; zero-state).')),
  true,
  'expected repeat zero-state records skip log'
);

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const recordsIncrementalDir = path.join(repoCacheRoot, 'incremental', 'records');
const seedUnsupportedDb = new Database(outputPath);
seedUnsupportedDb.exec('INSERT INTO chunks (id, mode) VALUES (1, \'records\');');
seedUnsupportedDb.close();
await fs.mkdir(path.join(recordsIncrementalDir, 'files'), { recursive: true });
const unsupportedManifest = {
  version: 5,
  mode: 'records',
  files: {}
};
setRecordsIncrementalCapability(unsupportedManifest, false);
await fs.writeFile(
  path.join(recordsIncrementalDir, 'manifest.json'),
  `${JSON.stringify(unsupportedManifest, null, 2)}\n`,
  'utf8'
);

const unsupportedLogs = [];
await buildSqliteIndex({
  root: repoRoot,
  mode: 'records',
  incremental: true,
  indexRoot: buildRoot,
  out: outputPath,
  recordsDir: recordsIndexDir,
  emitOutput: true,
  logger: {
    log: (message) => unsupportedLogs.push(String(message || '')),
    warn: (message) => unsupportedLogs.push(String(message || '')),
    error: (message) => unsupportedLogs.push(String(message || ''))
  },
  exitOnError: false
});
const unsupportedOutput = unsupportedLogs.join('\n').toLowerCase();
assert.equal(
  unsupportedOutput.includes('records incremental bundles unsupported')
    || unsupportedOutput.includes('incremental bundles skipped for records'),
  true,
  'expected unsupported records incremental capability warning'
);
assert.equal(
  unsupportedOutput.includes('using artifacts'),
  true,
  'expected unsupported records incremental manifest to fall back to artifacts'
);

console.log('sqlite skip empty records rebuild test passed');
