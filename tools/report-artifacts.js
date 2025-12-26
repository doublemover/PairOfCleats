#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { getCacheRoot, getDictConfig, getRepoCacheRoot, loadUserConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json'],
  default: { json: false }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const dictDir = dictConfig.dir;
const sqlitePath = userConfig.sqlite?.dbPath
  ? path.resolve(userConfig.sqlite.dbPath)
  : path.join(root, 'index-sqlite', 'index.db');

async function sizeOfPath(targetPath) {
  try {
    const stat = await fsPromises.lstat(targetPath);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;

    const entries = await fsPromises.readdir(targetPath);
    let total = 0;
    for (const entry of entries) {
      total += await sizeOfPath(path.join(targetPath, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unit]}`;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const repoArtifacts = {
  indexCode: path.join(repoCacheRoot, 'index-code'),
  indexProse: path.join(repoCacheRoot, 'index-prose'),
  repometrics: path.join(repoCacheRoot, 'repometrics')
};

const repoCacheSize = await sizeOfPath(repoCacheRoot);
const repoArtifactSizes = {};
for (const [name, artifactPath] of Object.entries(repoArtifacts)) {
  repoArtifactSizes[name] = await sizeOfPath(artifactPath);
}

const sqliteExists = fs.existsSync(sqlitePath);
const sqliteSize = sqliteExists ? await sizeOfPath(sqlitePath) : 0;
const cacheRootSize = await sizeOfPath(cacheRoot);
const dictSize = await sizeOfPath(dictDir);
const sqliteInsideCache = sqliteExists && isInside(path.resolve(cacheRoot), sqlitePath);
const overallSize = cacheRootSize + (sqliteExists && !sqliteInsideCache ? sqliteSize : 0);

if (argv.json) {
  const payload = {
    repo: {
      root: path.resolve(repoCacheRoot),
      totalBytes: repoCacheSize,
      artifacts: repoArtifactSizes,
      sqlite: sqliteExists ? { path: sqlitePath, bytes: sqliteSize } : null
    },
    overall: {
      cacheRoot: path.resolve(cacheRoot),
      cacheBytes: cacheRootSize,
      dictionaryBytes: dictSize,
      sqliteOutsideCacheBytes: sqliteInsideCache ? 0 : sqliteSize,
      totalBytes: overallSize
    }
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log('Repo artifacts');
console.log(`- cache root: ${formatBytes(repoCacheSize)} (${path.resolve(repoCacheRoot)})`);
console.log(`- index-code: ${formatBytes(repoArtifactSizes.indexCode)} (${path.resolve(repoArtifacts.indexCode)})`);
console.log(`- index-prose: ${formatBytes(repoArtifactSizes.indexProse)} (${path.resolve(repoArtifacts.indexProse)})`);
console.log(`- repometrics: ${formatBytes(repoArtifactSizes.repometrics)} (${path.resolve(repoArtifacts.repometrics)})`);
if (sqliteExists) {
  console.log(`- sqlite db: ${formatBytes(sqliteSize)} (${sqlitePath})`);
} else {
  console.log(`- sqlite db: missing (${sqlitePath})`);
}

console.log('\nOverall');
console.log(`- cache root: ${formatBytes(cacheRootSize)} (${path.resolve(cacheRoot)})`);
console.log(`- dictionaries: ${formatBytes(dictSize)} (${path.resolve(dictDir)})`);
if (sqliteExists && !sqliteInsideCache) {
  console.log(`- sqlite outside cache: ${formatBytes(sqliteSize)} (${sqlitePath})`);
}
console.log(`- total: ${formatBytes(overallSize)}`);
