#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveLmdbPaths, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const repoRoot = resolveTestCachePath(root, 'sqlite-lmdb-path-traversal');
await fs.rm(repoRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const sqliteDefaults = resolveSqlitePaths(repoRoot, {});
const sqliteEscaped = resolveSqlitePaths(repoRoot, {
  sqlite: {
    dbDir: path.join('..', 'outside-sqlite-dir'),
    codeDbPath: path.join('..', 'outside-code.db'),
    proseDbPath: path.join('..', 'outside-prose.db'),
    extractedProseDbPath: path.join('..', 'outside-extracted.db'),
    recordsDbPath: path.join('..', 'outside-records.db')
  }
});

assert.equal(sqliteEscaped.dbDir, sqliteDefaults.dbDir, 'sqlite dbDir traversal should fall back to default');
assert.equal(sqliteEscaped.codePath, sqliteDefaults.codePath, 'sqlite codeDbPath traversal should fall back to default');
assert.equal(sqliteEscaped.prosePath, sqliteDefaults.prosePath, 'sqlite proseDbPath traversal should fall back to default');
assert.equal(
  sqliteEscaped.extractedProsePath,
  sqliteDefaults.extractedProsePath,
  'sqlite extractedProseDbPath traversal should fall back to default'
);
assert.equal(
  sqliteEscaped.recordsPath,
  sqliteDefaults.recordsPath,
  'sqlite recordsDbPath traversal should fall back to default'
);

const sqliteLocal = resolveSqlitePaths(repoRoot, {
  sqlite: {
    dbDir: path.join('local', 'sqlite')
  }
});
assert.equal(
  sqliteLocal.dbDir,
  path.resolve(repoRoot, 'local', 'sqlite'),
  'sqlite relative dbDir inside repo should resolve normally'
);

const lmdbDefaults = resolveLmdbPaths(repoRoot, {});
const lmdbEscaped = resolveLmdbPaths(repoRoot, {
  lmdb: {
    dbDir: path.join('..', 'outside-lmdb-dir'),
    codeDbPath: path.join('..', 'outside-code'),
    proseDbPath: path.join('..', 'outside-prose')
  }
});

assert.equal(lmdbEscaped.dbDir, lmdbDefaults.dbDir, 'lmdb dbDir traversal should fall back to default');
assert.equal(lmdbEscaped.codePath, lmdbDefaults.codePath, 'lmdb codeDbPath traversal should fall back to default');
assert.equal(lmdbEscaped.prosePath, lmdbDefaults.prosePath, 'lmdb proseDbPath traversal should fall back to default');

console.log('sqlite/lmdb path traversal test passed');
