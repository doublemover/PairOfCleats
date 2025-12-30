#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { getCacheRoot, getDictConfig, getRepoCacheRoot, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'all'],
  string: ['repo'],
  default: { json: false, all: false }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const dictConfig = getDictConfig(root, userConfig);
const dictDir = dictConfig.dir;
const sqlitePaths = resolveSqlitePaths(root, userConfig);
const sqliteTargets = [
  { label: 'code', path: sqlitePaths.codePath },
  { label: 'prose', path: sqlitePaths.prosePath }
];

/**
 * Recursively compute the size of a file or directory.
 * @param {string} targetPath
 * @returns {Promise<number>}
 */
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

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
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

/**
 * Check if a path is contained within another path.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const repoArtifacts = {
  indexCode: path.join(repoCacheRoot, 'index-code'),
  indexProse: path.join(repoCacheRoot, 'index-prose'),
  repometrics: path.join(repoCacheRoot, 'repometrics'),
  incremental: path.join(repoCacheRoot, 'incremental')
};

const repoCacheSize = await sizeOfPath(repoCacheRoot);
const repoArtifactSizes = {};
for (const [name, artifactPath] of Object.entries(repoArtifacts)) {
  repoArtifactSizes[name] = await sizeOfPath(artifactPath);
}

const sqliteStats = {};
let sqliteOutsideCacheSize = 0;
for (const target of sqliteTargets) {
  const exists = fs.existsSync(target.path);
  const size = exists ? await sizeOfPath(target.path) : 0;
  sqliteStats[target.label] = exists ? { path: target.path, bytes: size } : null;
  if (exists && !isInside(path.resolve(cacheRoot), target.path)) {
    sqliteOutsideCacheSize += size;
  }
}
const cacheRootSize = await sizeOfPath(cacheRoot);
const dictSize = await sizeOfPath(dictDir);
const overallSize = cacheRootSize + sqliteOutsideCacheSize;

const health = { issues: [], hints: [] };
const indexIssues = [];
if (!fs.existsSync(repoArtifacts.indexCode)) {
  indexIssues.push('index-code directory missing');
} else {
  if (!fs.existsSync(path.join(repoArtifacts.indexCode, 'chunk_meta.json'))) {
    indexIssues.push('index-code chunk_meta.json missing');
  }
  if (!fs.existsSync(path.join(repoArtifacts.indexCode, 'token_postings.json'))) {
    indexIssues.push('index-code token_postings.json missing');
  }
}
if (!fs.existsSync(repoArtifacts.indexProse)) {
  indexIssues.push('index-prose directory missing');
} else {
  if (!fs.existsSync(path.join(repoArtifacts.indexProse, 'chunk_meta.json'))) {
    indexIssues.push('index-prose chunk_meta.json missing');
  }
  if (!fs.existsSync(path.join(repoArtifacts.indexProse, 'token_postings.json'))) {
    indexIssues.push('index-prose token_postings.json missing');
  }
}
if (indexIssues.length) {
  health.issues.push(...indexIssues);
  health.hints.push('Run `npm run build-index` to rebuild file-backed indexes.');
}

const sqliteIssues = [];
if (userConfig.sqlite?.use === true) {
  if (!fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('sqlite code db missing');
  if (!fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('sqlite prose db missing');
}
if (sqliteIssues.length) {
  health.issues.push(...sqliteIssues);
  health.hints.push('Run `npm run build-sqlite-index` to rebuild SQLite indexes.');
}

const repoRollups = [];
if (argv.all) {
  const reposRoot = path.join(cacheRoot, 'repos');
  if (fs.existsSync(reposRoot)) {
    const entries = await fsPromises.readdir(reposRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(reposRoot, entry.name);
      const bytes = await sizeOfPath(repoPath);
      const stat = await fsPromises.stat(repoPath);
      repoRollups.push({
        id: entry.name,
        path: path.resolve(repoPath),
        bytes,
        mtime: stat.mtime ? stat.mtime.toISOString() : null
      });
    }
  }
}

if (argv.json) {
  const sqlitePayload = {
    code: sqliteStats.code,
    prose: sqliteStats.prose,
    legacy: sqlitePaths.legacyExists ? { path: sqlitePaths.legacyPath } : null
  };
  const payload = {
    repo: {
      root: path.resolve(repoCacheRoot),
      totalBytes: repoCacheSize,
      artifacts: repoArtifactSizes,
      sqlite: sqlitePayload
    },
    health,
    overall: {
      cacheRoot: path.resolve(cacheRoot),
      cacheBytes: cacheRootSize,
      dictionaryBytes: dictSize,
      sqliteOutsideCacheBytes: sqliteOutsideCacheSize,
      totalBytes: overallSize
    }
  };
  if (argv.all) {
    const totalRepoBytes = repoRollups.reduce((sum, repo) => sum + repo.bytes, 0);
    payload.allRepos = {
      root: path.resolve(path.join(cacheRoot, 'repos')),
      repos: repoRollups,
      totalBytes: totalRepoBytes
    };
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log('Repo artifacts');
console.log(`- cache root: ${formatBytes(repoCacheSize)} (${path.resolve(repoCacheRoot)})`);
console.log(`- index-code: ${formatBytes(repoArtifactSizes.indexCode)} (${path.resolve(repoArtifacts.indexCode)})`);
console.log(`- index-prose: ${formatBytes(repoArtifactSizes.indexProse)} (${path.resolve(repoArtifacts.indexProse)})`);
console.log(`- repometrics: ${formatBytes(repoArtifactSizes.repometrics)} (${path.resolve(repoArtifacts.repometrics)})`);
console.log(`- incremental: ${formatBytes(repoArtifactSizes.incremental)} (${path.resolve(repoArtifacts.incremental)})`);
const code = sqliteStats.code;
const prose = sqliteStats.prose;
console.log(`- sqlite code db: ${code ? formatBytes(code.bytes) : 'missing'} (${code?.path || sqlitePaths.codePath})`);
console.log(`- sqlite prose db: ${prose ? formatBytes(prose.bytes) : 'missing'} (${prose?.path || sqlitePaths.prosePath})`);
if (sqlitePaths.legacyExists) {
  console.log(`- legacy sqlite db: ${sqlitePaths.legacyPath}`);
}

console.log('\nOverall');
console.log(`- cache root: ${formatBytes(cacheRootSize)} (${path.resolve(cacheRoot)})`);
console.log(`- dictionaries: ${formatBytes(dictSize)} (${path.resolve(dictDir)})`);
if (sqliteOutsideCacheSize) {
  console.log(`- sqlite outside cache: ${formatBytes(sqliteOutsideCacheSize)}`);
}
console.log(`- total: ${formatBytes(overallSize)}`);

if (health.issues.length) {
  console.log('\nHealth');
  health.issues.forEach((issue) => console.log(`- issue: ${issue}`));
  health.hints.forEach((hint) => console.log(`- hint: ${hint}`));
}

if (argv.all) {
  const totalRepoBytes = repoRollups.reduce((sum, repo) => sum + repo.bytes, 0);
  console.log('\nAll repos');
  console.log(`- root: ${path.resolve(path.join(cacheRoot, 'repos'))}`);
  console.log(`- total: ${formatBytes(totalRepoBytes)}`);
  for (const repo of repoRollups.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`- ${repo.id}: ${formatBytes(repo.bytes)} (${repo.path})`);
  }
}
