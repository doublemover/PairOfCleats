import { captureSelectedModeRoots } from '../../shared/indexing/selected-mode-roots.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { validateSqliteZeroStateManifest } from '../../storage/sqlite/zero-state.js';
import { readRuntimeReceipt } from '../../shared/runtime-envelope/read-receipt.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, resolveRepoCacheRootPath, getRepoRoot } from '../../shared/repo-paths.js';
import { getCacheRoot, getDictConfig, getMetricsDir, loadUserConfig, resolveLmdbPaths, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../../shared/artifact-io/manifest.js';
import { getAtomicWriteDurabilityStatus } from '../../shared/io/atomic-write.js';
import { isPathUnderDir } from '../../shared/path-normalize.js';
import { sizeOfPath } from '../../shared/disk-space.js';
import { hasLmdbStore } from '../../storage/lmdb/utils.js';
import { readIndexCoverage, readCurrentProvenance } from './status-coverage.js';
import { compareIndexedFiles } from './status-freshness.js';
import { discoverFreshnessFiles } from './status-discovery.js';

const MAX_STATUS_JSON_BYTES = 8 * 1024 * 1024;


/**
 * Collect artifact sizes and health status for a repo.
 * @param {{repoRoot?:string,includeAll?:boolean}} input
 * @returns {Promise<object>}
 */
export async function getStatus(input = {}) {
  const root = getRepoRoot(input.repoRoot);
  const includeAll = input.includeAll === true;
  const userConfig = loadUserConfig(root);
  const cacheRoot = (userConfig.cache && userConfig.cache.root)
    || getCacheRoot();
  const repoCacheRoot = resolveRepoCacheRootPath(root, userConfig);
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig.dir;
  const selection = captureSelectedModeRoots({ root, userConfig });
  const sqlitePaths = resolveSqlitePaths(root, userConfig);
  for (const [mode, key] of [['code', 'codePath'], ['prose', 'prosePath'], ['extracted-prose', 'extractedProsePath'], ['records', 'recordsPath']]) {
    if (selection.roots[mode]) sqlitePaths[key] = resolveSqlitePaths(root, userConfig, { indexRoot: selection.roots[mode] })[key];
  }
  const lmdbPaths = resolveLmdbPaths(root, userConfig);
  for (const mode of ['code', 'prose']) {
    if (selection.roots[mode]) lmdbPaths[`${mode}Path`] = resolveLmdbPaths(root, userConfig, { indexRoot: selection.roots[mode] })[`${mode}Path`];
  }

  const indexCodeDir = selection.roots['code'] ? path.join(selection.roots['code'], 'index-code') : getIndexDir(root, 'code', userConfig);
  const indexProseDir = selection.roots['prose'] ? path.join(selection.roots['prose'], 'index-prose') : getIndexDir(root, 'prose', userConfig);
  const indexExtractedProseDir = selection.roots['extracted-prose'] ? path.join(selection.roots['extracted-prose'], 'index-extracted-prose') : getIndexDir(root, 'extracted-prose', userConfig);
  const indexRecordsDir = selection.roots['records'] ? path.join(selection.roots['records'], 'index-records') : getIndexDir(root, 'records', userConfig);
  const repoArtifacts = {
    indexCode: indexCodeDir,
    indexProse: indexProseDir,
    indexExtractedProse: indexExtractedProseDir,
    indexRecords: indexRecordsDir,
    metrics: path.join(repoCacheRoot, 'metrics'),
    queryCache: path.join(repoCacheRoot, 'query-cache'),
    incremental: path.join(repoCacheRoot, 'incremental'),
    snapshots: path.join(repoCacheRoot, 'snapshots')
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
  const durability = getAtomicWriteDurabilityStatus({
    repoPath: root,
    cacheRoot,
    repoCacheRoot
  });
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
    if (exists && !isPathUnderDir(path.resolve(cacheRoot), target.path)) {
      sqliteOutsideCacheSize += size;
    }
  }
  const lmdbTargets = [
    { label: 'code', path: lmdbPaths.codePath },
    { label: 'prose', path: lmdbPaths.prosePath }
  ];
  for (const target of lmdbTargets) {
    const exists = hasLmdbStore(target.path);
    const size = exists ? await sizeOfPath(target.path) : 0;
    lmdbStats[target.label] = exists ? { path: target.path, bytes: size } : null;
    if (exists && !isPathUnderDir(path.resolve(cacheRoot), target.path)) {
      lmdbOutsideCacheSize += size;
    }
  }

  const cacheRootSize = await sizeOfPath(cacheRoot);
  const dictSize = await sizeOfPath(dictDir);
  const overallSize = cacheRootSize + sqliteOutsideCacheSize + lmdbOutsideCacheSize;

  const health = { issues: [], hints: [], selection: selection.source, modes: {}, backends: { sqlite: {}, lmdb: {} } };
  const modeStates = {};
  for (const mode of selection.modes) {
    try { modeStates[mode] = readJsonFile(path.join(selection.roots[mode], `index-${mode}`, 'index_state.json'), { maxBytes: MAX_STATUS_JSON_BYTES, containedRoot: path.join(selection.roots[mode], `index-${mode}`) }); }
    catch (error) { modeStates[mode] = null; health.issues.push(`index-${mode} selected capability metadata unreadable`); }
  }
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
    if (modeStates[label.replace(/^index-/, '')]?.artifacts?.present?.token_postings === false) return;
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
  for (const [mode, dir] of Object.entries({ code: indexCodeDir, prose: indexProseDir,
    'extracted-prose': indexExtractedProseDir, records: indexRecordsDir })) {
    const selected = selection.modes.includes(mode);
    health.modes[mode] = { selected, status: selected ? 'selected' : 'not-built', path: selected ? dir : null };
    if (selected) {
      const before = indexIssues.length;
      checkIndexArtifacts(dir, `index-${mode}`);
      if (indexIssues.length > before || !modeStates[mode]) health.modes[mode].status = 'invalid';
    }
  }
  if (indexIssues.length) {
    health.issues.push(...indexIssues);
    health.hints.push('Run `pairofcleats index build` (or `node build_index.js`) to rebuild file-backed indexes.');
  }

  const sqliteIssues = [];
  const lmdbIssues = [];
  for (const target of sqliteTargets) {
    const mode = target.label;
    const state = modeStates[mode]?.sqlite;
    let status = !selection.modes.includes(mode) ? 'not-selected' : !state ? 'not-built'
      : state.status === 'ready' ? 'ready' : state.status || 'unknown';
    if (status === 'ready' && !fs.existsSync(target.path)) {
      const indexDir = path.join(selection.roots[mode], `index-${mode}`);
      const markerPath = path.join(indexDir, 'pieces', 'sqlite-zero-state.json');
      try {
        await validateSqliteZeroStateManifest({ indexDir, mode, outputPath: target.path,
          payload: readJsonFile(markerPath, { containedRoot: indexDir }) });
        status = 'zero-state';
      } catch { status = 'missing'; sqliteIssues.push(`sqlite ${mode} published db missing or zero-state proof invalid`); }
    } else if (status === 'failed') sqliteIssues.push(`sqlite ${mode} build failed`);
    health.backends.sqlite[mode] = { status, selected: selection.modes.includes(mode), path: target.path };
  }
  for (const target of lmdbTargets) {
    const state = modeStates[target.label]?.lmdb;
    let status = !selection.modes.includes(target.label) ? 'not-selected' : !state ? 'unknown'
      : state.status === 'ready' ? 'ready' : state.status || 'unknown';
    if (status === 'ready' && !hasLmdbStore(target.path)) {
      status = 'missing'; lmdbIssues.push(`lmdb ${target.label} published db missing`);
    } else if (status === 'failed') lmdbIssues.push(`lmdb ${target.label} build failed`);
    health.backends.lmdb[target.label] = { status, selected: selection.modes.includes(target.label), path: target.path };
  }
  if (sqliteIssues.length) {
    health.issues.push(...sqliteIssues);
    health.hints.push('Run `pairofcleats index build --stage 4` to rebuild selected SQLite indexes.');
  }
  if (lmdbIssues.length) {
    health.issues.push(...lmdbIssues);
    health.hints.push('Run `pairofcleats lmdb build` to rebuild selected LMDB indexes.');
  }

  const coverage = readIndexCoverage({
    currentProvenance: await readCurrentProvenance(root, userConfig.indexing?.scm?.provider),
    metricsDir: getMetricsDir(root, userConfig),
    repoCacheRoot,
    indexes: { code: indexCodeDir, prose: indexProseDir, 'extracted-prose': indexExtractedProseDir, records: indexRecordsDir }
  });
  const discovery = await discoverFreshnessFiles({ repoRoot: root, userConfig });
  coverage.discovery = { status: discovery.status };
  for (const [mode, indexDir] of Object.entries({ code: indexCodeDir, prose: indexProseDir,
    'extracted-prose': indexExtractedProseDir, records: indexRecordsDir })) {
    coverage.modes[mode].selected = selection.modes.includes(mode);
    if (!selection.modes.includes(mode)) continue;
    coverage.modes[mode].workingTree = await compareIndexedFiles({ repoRoot: root, indexDir,
      currentFiles: discovery.files?.[mode], discoveryStatus: discovery.status });
  }
  coverage.workingTreeComparison = 'bounded-indexed-files-and-discovery';
  const payload = {
    coverage,
    repo: {
      root: path.resolve(root),
      cacheRoot: path.resolve(repoCacheRoot),
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
      },
      indexDirs: { code: indexCodeDir, prose: indexProseDir,
        'extracted-prose': indexExtractedProseDir, records: indexRecordsDir }
    },
    health,
    runtime: await Promise.all(Array.from(new Set([
      indexCodeDir, indexProseDir, indexExtractedProseDir, indexRecordsDir
    ].map((directory) => path.dirname(directory)))).map((buildRoot) => readRuntimeReceipt({
      buildRoot, selection: 'published-mode-root'
    }))),
    durability,
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

/**
 * @typedef {{repoRoot?:string,includeAll?:boolean}} StatusRequest
 * @typedef {{repo:object,health:object,overall:object,allRepos?:{root:string,repos:object[],totalBytes:number}}} StatusResult
 * @param {StatusRequest|string} [input]
 * @param {StatusRequest} [options] Options for the string overload.
 * @returns {Promise<StatusResult>}
 */
export async function status(input = {}, options = {}) {
  if (typeof input === 'string') {
    return getStatus({ ...options, repoRoot: input });
  }
  return getStatus(input);
}
