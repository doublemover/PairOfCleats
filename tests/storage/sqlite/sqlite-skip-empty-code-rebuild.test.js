#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSqliteIndex } from '../../../tools/build/sqlite/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-skip-empty-code-rebuild');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildRoot = path.join(tempRoot, 'build-root');
const codeIndexDir = path.join(buildRoot, 'index-code');
const sqliteDir = path.join(buildRoot, 'index-sqlite');
const outputPath = path.join(sqliteDir, 'index-code.db');

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

const seedDb = new Database(outputPath);
seedDb.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, mode TEXT NOT NULL);');
seedDb.close();

const before = await fs.stat(outputPath);
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
const after = await fs.stat(outputPath);

assert.equal(after.mtimeMs, before.mtimeMs, 'expected empty code sqlite db to remain unchanged');
assert.equal(
  logs.some((line) => line.includes('skipping sqlite rebuild (artifacts empty; existing db empty).')),
  true,
  'expected generic skip log for empty code rebuild'
);

console.log('sqlite skip empty code rebuild test passed');
