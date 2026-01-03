#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getCacheRoot, getRepoCacheRoot, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { isInside, isRootPath } from './path-utils.js';

const argv = createCli({
  scriptName: 'clean-artifacts',
  options: {
    all: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const defaultSqliteDir = path.join(repoCacheRoot, 'index-sqlite');
const legacyRepoSqliteDir = path.join(root, 'index-sqlite');
const defaultCodePath = path.join(defaultSqliteDir, 'index-code.db');
const defaultProsePath = path.join(defaultSqliteDir, 'index-prose.db');
const defaultLegacyPath = path.join(defaultSqliteDir, 'index.db');
const sqlitePaths = resolveSqlitePaths(root, userConfig);


const targets = [];
const repoCachesRoot = path.join(cacheRoot, 'repos');
const primary = argv.all ? repoCachesRoot : repoCacheRoot;
targets.push(primary);

const base = argv.all ? path.resolve(repoCachesRoot) : path.resolve(repoCacheRoot);
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

if (fs.existsSync(legacyRepoSqliteDir) && !isInside(base, path.resolve(legacyRepoSqliteDir))) {
  targets.push(legacyRepoSqliteDir);
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
