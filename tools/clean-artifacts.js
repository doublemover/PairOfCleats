#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { getCacheRoot, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['all', 'dry-run'],
  default: { all: false, 'dry-run': false }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const defaultSqliteDir = path.join(root, 'index-sqlite');
const defaultCodePath = path.join(defaultSqliteDir, 'index-code.db');
const defaultProsePath = path.join(defaultSqliteDir, 'index-prose.db');
const defaultLegacyPath = path.join(defaultSqliteDir, 'index.db');
const sqlitePaths = resolveSqlitePaths(root, userConfig);

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

const base = argv.all ? path.resolve(cacheRoot) : path.resolve(repoCacheRoot);
const sqliteFiles = [sqlitePaths.codePath, sqlitePaths.prosePath];
const usesDefaultDir = sqlitePaths.codePath === defaultCodePath
  && sqlitePaths.prosePath === defaultProsePath;

if (usesDefaultDir) {
  const anyExists = sqliteFiles.some((filePath) => fs.existsSync(filePath));
  if (anyExists && !isInside(base, path.resolve(defaultSqliteDir))) {
    targets.push(defaultSqliteDir);
  }
} else {
  for (const filePath of sqliteFiles) {
    if (!fs.existsSync(filePath)) continue;
    if (!isInside(base, path.resolve(filePath))) {
      targets.push(filePath);
    }
  }
}

if (fs.existsSync(sqlitePaths.legacyPath)) {
  const legacyTarget = sqlitePaths.legacyPath === defaultLegacyPath ? defaultSqliteDir : sqlitePaths.legacyPath;
  if (!isInside(base, path.resolve(legacyTarget))) {
    targets.push(legacyTarget);
  }
}

const uniqueTargets = Array.from(new Set(targets.map((target) => path.resolve(target))));
for (const target of uniqueTargets) {
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
