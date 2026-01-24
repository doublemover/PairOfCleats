import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCacheRoot, getDictConfig, getIndexDir, getMetricsDir, getRepoCacheRoot, getRepoRoot, loadUserConfig, resolveLmdbPaths, resolveSqlitePaths } from '../../../tools/dict-utils.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../../shared/artifact-io.js';
import { getEnvConfig } from '../../shared/env.js';

const MAX_STATUS_JSON_BYTES = 8 * 1024 * 1024;

const readJsonWithLimit = async (targetPath, maxBytes = MAX_STATUS_JSON_BYTES) => {
  try {
    const stat = await fsPromises.stat(targetPath);
    if (!stat.isFile()) return null;
    if (Number.isFinite(maxBytes) && stat.size > maxBytes) {
      return { data: null, bytes: stat.size, truncated: true };
    }
    const data = JSON.parse(await fsPromises.readFile(targetPath, 'utf8'));
    return { data, bytes: stat.size, truncated: false };
  } catch {
    return null;
  }
};

const summarizeShardPlan = (plan) => {
  if (!Array.isArray(plan) || !plan.length) return null;
  let totalFiles = 0;
  let totalLines = 0;
  let maxFiles = 0;
  let maxLines = 0;
  let maxShard = null;
  for (const shard of plan) {
    const files = Number(shard?.fileCount) || 0;
    const lines = Number(shard?.lineCount) || 0;
    totalFiles += files;
    totalLines += lines;
    if (files > maxFiles || lines > maxLines) {
      maxFiles = Math.max(maxFiles, files);
      maxLines = Math.max(maxLines, lines);
      maxShard = shard || null;
    }
  }
  const sample = [...plan]
    .sort((a, b) => (Number(b?.lineCount) || 0) - (Number(a?.lineCount) || 0))
    .slice(0, Math.min(5, plan.length))
    .map((shard) => ({
      id: shard.id || null,
      label: shard.label || shard.id || null,
      lang: shard.lang || null,
      dir: shard.dir || null,
      files: Number(shard.fileCount) || 0,
      lines: Number(shard.lineCount) || 0
    }));
  return {
    count: plan.length,
    totalFiles,
    totalLines,
    maxFiles,
    maxLines,
    largest: maxShard
      ? {
        id: maxShard.id || null,
        label: maxShard.label || maxShard.id || null,
        files: Number(maxShard.fileCount) || 0,
        lines: Number(maxShard.lineCount) || 0
      }
      : null,
    sample
  };
};

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
  const root = getRepoRoot(input.repoRoot);
  const includeAll = input.includeAll === true;
  const userConfig = loadUserConfig(root);
  const envConfig = getEnvConfig();
  const cacheRoot = (userConfig.cache && userConfig.cache.root)
    || envConfig.cacheRoot
    || getCacheRoot();
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig.dir;
  const sqlitePaths = resolveSqlitePaths(root, userConfig);
  const lmdbPaths = resolveLmdbPaths(root, userConfig);

  const indexCodeDir = getIndexDir(root, 'code', userConfig);
  const indexProseDir = getIndexDir(root, 'prose', userConfig);
  const indexExtractedProseDir = getIndexDir(root, 'extracted-prose', userConfig);
  const indexRecordsDir = getIndexDir(root, 'records', userConfig);
  const repoArtifacts = {
    indexCode: indexCodeDir,
    indexProse: indexProseDir,
    indexExtractedProse: indexExtractedProseDir,
    indexRecords: indexRecordsDir,
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
  const lmdbStats = {};
  let lmdbOutsideCacheSize = 0;
  const sqliteTargets = [
    { label: 'code', path: sqlitePaths.codePath },
    { label: 'prose', path: sqlitePaths.prosePath },
    { label: 'extracted-prose', path: sqlitePaths.extractedProsePath },
    { label: 'records', path: sqlitePaths.recordsPath }
  ];
  for (const target of sqliteTargets) {
    const exists = fs.existsSync(target.path);
    const size = exists ? await sizeOfPath(target.path) : 0;
    sqliteStats[target.label] = exists ? { path: target.path, bytes: size } : null;
    if (exists && !isInside(path.resolve(cacheRoot), target.path)) {
      sqliteOutsideCacheSize += size;
    }
  }
  const lmdbTargets = [
    { label: 'code', path: lmdbPaths.codePath },
    { label: 'prose', path: lmdbPaths.prosePath }
  ];
  for (const target of lmdbTargets) {
    const exists = fs.existsSync(path.join(target.path, 'data.mdb'));
    const size = exists ? await sizeOfPath(target.path) : 0;
    lmdbStats[target.label] = exists ? { path: target.path, bytes: size } : null;
    if (exists && !isInside(path.resolve(cacheRoot), target.path)) {
      lmdbOutsideCacheSize += size;
    }
  }

  const cacheRootSize = await sizeOfPath(cacheRoot);
  const dictSize = await sizeOfPath(dictDir);
  const overallSize = cacheRootSize + sqliteOutsideCacheSize + lmdbOutsideCacheSize;

  const health = { issues: [], hints: [] };
  const indexIssues = [];
  const checkIndexArtifacts = (dir, label) => {
    if (!fs.existsSync(dir)) {
      indexIssues.push(`${label} directory missing`);
      return;
    }
    let manifest = null;
    try {
      manifest = loadPiecesManifest(dir, { maxBytes: MAX_STATUS_JSON_BYTES, strict: true });
    } catch (err) {
      if (err?.code === 'ERR_MANIFEST_MISSING') {
        indexIssues.push(`${label} pieces/manifest.json missing`);
      } else if (err?.code === 'ERR_MANIFEST_INVALID') {
        indexIssues.push(`${label} pieces/manifest.json invalid`);
      } else {
        indexIssues.push(`${label} pieces/manifest.json unreadable`);
      }
      return;
    }
    const chunkMeta = resolveArtifactPresence(dir, 'chunk_meta', {
      manifest,
      maxBytes: MAX_STATUS_JSON_BYTES,
      strict: true
    });
    if (chunkMeta.error) {
      indexIssues.push(`${label} chunk_meta manifest invalid`);
    } else if (chunkMeta.format === 'missing') {
      indexIssues.push(`${label} chunk_meta missing in manifest`);
    } else if (chunkMeta.missingMeta || (chunkMeta.missingPaths && chunkMeta.missingPaths.length)) {
      indexIssues.push(`${label} chunk_meta manifest paths missing`);
    }
    const tokenPostings = resolveArtifactPresence(dir, 'token_postings', {
      manifest,
      maxBytes: MAX_STATUS_JSON_BYTES,
      strict: true
    });
    if (tokenPostings.error) {
      indexIssues.push(`${label} token_postings manifest invalid`);
    } else if (tokenPostings.format === 'missing') {
      indexIssues.push(`${label} token_postings missing in manifest`);
    } else if (tokenPostings.missingMeta || (tokenPostings.missingPaths && tokenPostings.missingPaths.length)) {
      indexIssues.push(`${label} token_postings manifest paths missing`);
    }
  };
  checkIndexArtifacts(indexCodeDir, 'index-code');
  checkIndexArtifacts(indexProseDir, 'index-prose');
  checkIndexArtifacts(indexExtractedProseDir, 'index-extracted-prose');
  checkIndexArtifacts(indexRecordsDir, 'index-records');
  if (indexIssues.length) {
    health.issues.push(...indexIssues);
    health.hints.push('Run `npm run build-index` to rebuild file-backed indexes.');
  }

  const sqliteIssues = [];
  if (userConfig.sqlite?.use !== false) {
    if (!fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('sqlite code db missing');
    if (!fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('sqlite prose db missing');
    if (!fs.existsSync(sqlitePaths.extractedProsePath)) sqliteIssues.push('sqlite extracted-prose db missing');
    if (!fs.existsSync(sqlitePaths.recordsPath)) sqliteIssues.push('sqlite records db missing');
  }
  if (sqliteIssues.length) {
    health.issues.push(...sqliteIssues);
    health.hints.push('Run `npm run build-sqlite-index` to rebuild SQLite indexes.');
  }

  const lmdbIssues = [];
  if (userConfig.lmdb?.use !== false) {
    if (!fs.existsSync(path.join(lmdbPaths.codePath, 'data.mdb'))) {
      lmdbIssues.push('lmdb code db missing');
    }
    if (!fs.existsSync(path.join(lmdbPaths.prosePath, 'data.mdb'))) {
      lmdbIssues.push('lmdb prose db missing');
    }
  }
  if (lmdbIssues.length) {
    health.issues.push(...lmdbIssues);
    health.hints.push('Run `npm run build-lmdb-index` to rebuild LMDB indexes.');
  }

  const payload = {
    repo: {
      root: path.resolve(repoCacheRoot),
      totalBytes: repoCacheSize,
        artifacts: repoArtifactSizes,
        sqlite: {
          code: sqliteStats.code,
          prose: sqliteStats.prose,
          extractedProse: sqliteStats['extracted-prose'],
          records: sqliteStats.records,
          legacy: sqlitePaths.legacyExists ? { path: sqlitePaths.legacyPath } : null
        },
      lmdb: {
        code: lmdbStats.code,
        prose: lmdbStats.prose
      }
    },
    health,
    overall: {
      cacheRoot: path.resolve(cacheRoot),
      cacheBytes: cacheRootSize,
      dictionaryBytes: dictSize,
      sqliteOutsideCacheBytes: sqliteOutsideCacheSize,
      lmdbOutsideCacheBytes: lmdbOutsideCacheSize,
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
