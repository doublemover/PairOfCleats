#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { getCacheRoot, getRepoCacheRoot, loadUserConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['all', 'dry-run'],
  default: { all: false, 'dry-run': false }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const defaultSqliteDir = path.join(root, 'index-sqlite');
const defaultSqlitePath = path.join(defaultSqliteDir, 'index.db');
const sqlitePath = userConfig.sqlite?.dbPath
  ? path.resolve(userConfig.sqlite.dbPath)
  : defaultSqlitePath;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isRootPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return path.parse(resolved).root === resolved;
}

const targets = [];
const primary = argv.all ? cacheRoot : repoCacheRoot;
targets.push(primary);

const sqliteExists = fs.existsSync(sqlitePath);
if (sqliteExists) {
  const sqliteTarget = sqlitePath === defaultSqlitePath ? defaultSqliteDir : sqlitePath;
  const base = argv.all ? path.resolve(cacheRoot) : path.resolve(repoCacheRoot);
  if (!isInside(base, path.resolve(sqliteTarget))) {
    targets.push(sqliteTarget);
  }
}

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.log(`skip: ${target} (missing)`);
    continue;
  }
  if (isRootPath(target)) {
    console.error(`refusing to delete root path: ${target}`);
    process.exit(1);
  }

  if (argv['dry-run']) {
    console.log(`dry-run: would delete ${path.resolve(target)}`);
    continue;
  }

  await fsPromises.rm(target, { recursive: true, force: true });
  console.log(`deleted: ${path.resolve(target)}`);
}

console.log('\nCleanup complete.');
