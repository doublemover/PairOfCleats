#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSqliteIndex } from '../../../tools/build/sqlite/runner.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite empty code rebuild test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-skip-empty-code-rebuild');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildRoot = path.join(tempRoot, 'build-root');
const codeIndexDir = path.join(buildRoot, 'index-code');
const sqliteDir = path.join(buildRoot, 'index-sqlite');
const outputPath = path.join(sqliteDir, 'index-code.db');
const zeroStateManifestPath = path.join(codeIndexDir, 'pieces', 'sqlite-zero-state.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(codeIndexDir, { recursive: true });
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

await fs.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), '[]\n', 'utf8');
const logs = [];
await buildSqliteIndex({
  root: repoRoot,
  mode: 'code',
  indexRoot: buildRoot,
  out: outputPath,
  codeDir: codeIndexDir,
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
  'expected first-run empty code sqlite build to skip creating db'
);
assert.equal(
  await fs.access(zeroStateManifestPath).then(() => true).catch(() => false),
  true,
  'expected zero-state manifest for empty code mode'
);
assert.equal(
  logs.some((line) => line.includes('skipping sqlite rebuild (artifacts empty; zero-state).')),
  true,
  'expected zero-state skip log for empty code rebuild'
);

const seedDb = new Database(outputPath);
seedDb.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, mode TEXT NOT NULL);');
seedDb.close();
const before = await fs.stat(outputPath);
const secondRunLogs = [];
await buildSqliteIndex({
  root: repoRoot,
  mode: 'code',
  indexRoot: buildRoot,
  out: outputPath,
  codeDir: codeIndexDir,
  emitOutput: true,
  logger: {
    log: (message) => secondRunLogs.push(String(message || '')),
    warn: (message) => secondRunLogs.push(String(message || '')),
    error: (message) => secondRunLogs.push(String(message || ''))
  },
  exitOnError: false
});
const after = await fs.stat(outputPath);

assert.equal(after.mtimeMs, before.mtimeMs, 'expected empty code sqlite db to remain unchanged');
assert.equal(
  secondRunLogs.some((line) => line.includes('skipping sqlite rebuild (artifacts empty; zero-state).')),
  true,
  'expected repeat zero-state skip log for empty code rebuild'
);

console.log('sqlite skip empty code rebuild test passed');
