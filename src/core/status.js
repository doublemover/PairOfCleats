import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCacheRoot, getDictConfig, getRepoCacheRoot, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from '../../tools/dict-utils.js';

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
 * Check if a path is contained within another path.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Collect artifact sizes and health status for a repo.
 * @param {{repoRoot?:string,includeAll?:boolean}} input
 * @returns {Promise<object>}
 */
export async function getStatus(input = {}) {
  const root = input.repoRoot ? path.resolve(input.repoRoot) : resolveRepoRoot(process.cwd());
  const includeAll = input.includeAll === true;
  const userConfig = loadUserConfig(root);
  const cacheRoot = (userConfig.cache && userConfig.cache.root)
    || process.env.PAIROFCLEATS_CACHE_ROOT
    || getCacheRoot();
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig.dir;
  const sqlitePaths = resolveSqlitePaths(root, userConfig);

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
  const sqliteTargets = [
    { label: 'code', path: sqlitePaths.codePath },
    { label: 'prose', path: sqlitePaths.prosePath }
  ];
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
  if (userConfig.sqlite?.use !== false) {
    if (!fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('sqlite code db missing');
    if (!fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('sqlite prose db missing');
  }
  if (sqliteIssues.length) {
    health.issues.push(...sqliteIssues);
    health.hints.push('Run `npm run build-sqlite-index` to rebuild SQLite indexes.');
  }

  const payload = {
    repo: {
      root: path.resolve(repoCacheRoot),
      totalBytes: repoCacheSize,
      artifacts: repoArtifactSizes,
      sqlite: {
        code: sqliteStats.code,
        prose: sqliteStats.prose,
        legacy: sqlitePaths.legacyExists ? { path: sqlitePaths.legacyPath } : null
      }
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

  if (includeAll) {
    const repoRollups = [];
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
    const totalRepoBytes = repoRollups.reduce((sum, repo) => sum + repo.bytes, 0);
    payload.allRepos = {
      root: path.resolve(reposRoot),
      repos: repoRollups,
      totalBytes: totalRepoBytes
    };
  }

  return payload;
}
