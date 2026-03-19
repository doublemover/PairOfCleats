import path from 'node:path';
import { spawnSubprocessSync } from '../../../shared/subprocess.js';
import { pathExists } from '../../../shared/files.js';
import { MAX_JSON_BYTES, readJsonFile } from '../../../shared/artifact-io.js';
import { tryRequire } from '../../../shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../../shared/tantivy.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../../tools/shared/dict-utils.js';
import { loadIndex } from '../../cli-index.js';
import { loadIndexCached } from '../index-loader.js';
import { EMPTY_INDEX } from '../filter-index.js';

export function createIndexBackendLoader({
  rootDir,
  userConfig,
  useSqlite,
  useLmdb,
  emitOutput,
  annActive,
  filtersActive,
  contextExpansionEnabled,
  graphRankingEnabled,
  sqliteFtsRequested,
  backendLabel,
  backendForcedTantivy,
  indexCache,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  tantivyConfig,
  strict = true,
  resolvedDenseVectorMode,
  requiredArtifacts,
  loadIndexFromSqlite,
  loadIndexFromLmdb
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
  const runtimeConfig = getRuntimeConfig(rootDir, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);
  const hasRequirements = requiredArtifacts && typeof requiredArtifacts.has === 'function';
  const needsAnnArtifacts = hasRequirements ? requiredArtifacts.has('ann') : true;
  const needsFilterIndex = hasRequirements ? requiredArtifacts.has('filterIndex') : true;
  const needsFileRelations = hasRequirements ? requiredArtifacts.has('fileRelations') : true;
  const needsRepoMap = hasRequirements ? requiredArtifacts.has('repoMap') : true;
  const needsGraphRelations = hasRequirements
    ? requiredArtifacts.has('graphRelations')
    : (contextExpansionEnabled || graphRankingEnabled);
  const needsChunkMetaCold = Boolean(
    filtersActive
    || contextExpansionEnabled
    || graphRankingEnabled
    || needsFilterIndex
    || needsFileRelations
  );
  const lazyDenseVectorsEnabled = userConfig?.retrieval?.dense?.lazyLoad !== false;
  const resolvedTantivyConfig = normalizeTantivyConfig(tantivyConfig || userConfig.tantivy || {});
  const tantivyRequired = backendLabel === 'tantivy' || backendForcedTantivy === true;
  const tantivyEnabled = resolvedTantivyConfig.enabled || tantivyRequired;
  if (tantivyRequired) {
    const dep = tryRequire('tantivy');
    if (!dep.ok) {
      throw new Error('Tantivy backend requested but the optional "tantivy" module is not available.');
    }
  }

  const loadIndexCachedLocal = async (dir, options = {}, mode = null) => loadIndexCached({
    indexCache,
    dir,
    modelIdDefault,
    fileChargramN,
    includeHnsw: options.includeHnsw !== false,
    includeDense: options.includeDense !== false,
    includeMinhash: options.includeMinhash !== false,
    includeFilterIndex: options.includeFilterIndex !== false,
    includeFileRelations: options.includeFileRelations !== false,
    includeRepoMap: options.includeRepoMap !== false,
    includeChunkMetaCold: options.includeChunkMetaCold !== false,
    hnswConfig,
    denseVectorMode: resolvedDenseVectorMode,
    loadIndex: (targetDir, loadOptions) => loadIndex(targetDir, {
      ...loadOptions,
      strict,
      mode,
      denseVectorMode: resolvedDenseVectorMode
    })
  });

  const emptyIndex = () => ({ ...EMPTY_INDEX });
  const baseBackendLoadOptions = {
    includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex
  };
  const sqliteBackendLoadOptions = {
    ...baseBackendLoadOptions,
    includeChunks: sqliteContextChunks
  };
  const lmdbBackendLoadOptions = {
    ...baseBackendLoadOptions,
    includeChunks: true
  };
  const cachedLoadOptions = {
    ...baseBackendLoadOptions,
    includeFileRelations: needsFileRelations,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
  };
  const loadCachedModeIndex = (mode, dir, modeLoadOptions = cachedLoadOptions) => (
    loadIndexCachedLocal(dir, modeLoadOptions, mode)
  );

  const resolveTantivyAvailability = async (mode, indexDir) => {
    if (!tantivyEnabled || !indexDir) {
      return { dir: null, metaPath: null, meta: null, available: false };
    }
    const paths = resolveTantivyPaths(indexDir, mode, resolvedTantivyConfig);
    let meta = null;
    if (paths.metaPath && await pathExists(paths.metaPath)) {
      try {
        meta = readJsonFile(paths.metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    const available = Boolean(meta && paths.dir && await pathExists(paths.dir));
    return { ...paths, meta, available };
  };

  const ensureTantivyIndex = async (mode, indexDir) => {
    const availability = await resolveTantivyAvailability(mode, indexDir);
    if (availability.available) return availability;
    if (!tantivyRequired || !resolvedTantivyConfig.autoBuild) return availability;
    const toolRoot = resolveToolRoot();
    const scriptPath = path.join(toolRoot, 'tools', 'build/tantivy-index.js');
    const result = spawnSubprocessSync(
      process.execPath,
      [scriptPath, '--mode', mode, '--repo', rootDir],
      {
        stdio: emitOutput ? 'inherit' : 'ignore',
        rejectOnNonZeroExit: false,
        env: runtimeEnv
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Tantivy index build failed for mode=${mode}.`);
    }
    return resolveTantivyAvailability(mode, indexDir);
  };

  return {
    emptyIndex,
    cachedLoadOptions,
    needsAnnArtifacts,
    needsFileRelations,
    needsRepoMap,
    needsGraphRelations,
    lazyDenseVectorsEnabled,
    tantivyRequired,

    async loadModeIndex({
      mode,
      run,
      dir,
      backend = 'cached',
      modeLoadOptions = cachedLoadOptions,
      allowSqliteFallback = false
    }) {
      if (!run) return emptyIndex();
      if (backend === 'sqlite') {
        if (allowSqliteFallback) {
          try {
            return loadIndexFromSqlite(mode, sqliteBackendLoadOptions);
          } catch {
            return loadCachedModeIndex(mode, dir, modeLoadOptions);
          }
        }
        return loadIndexFromSqlite(mode, sqliteBackendLoadOptions);
      }
      if (backend === 'lmdb') {
        return loadIndexFromLmdb(mode, lmdbBackendLoadOptions);
      }
      return loadCachedModeIndex(mode, dir, modeLoadOptions);
    },

    async attachTantivy(idx, mode, dir) {
      if (!idx || !dir || !tantivyEnabled) return null;
      const availability = await ensureTantivyIndex(mode, dir);
      idx.tantivy = {
        dir: availability.dir,
        metaPath: availability.metaPath,
        meta: availability.meta,
        available: availability.available
      };
      return idx.tantivy;
    },

    assertRequiredTantivy({
      runCode,
      runProse,
      runRecords,
      resolvedRunExtractedProse,
      idxCode,
      idxProse,
      idxExtractedProse,
      idxRecords
    }) {
      if (!tantivyRequired) return;
      const missingModes = [];
      if (runCode && !idxCode?.tantivy?.available) missingModes.push('code');
      if (runProse && !idxProse?.tantivy?.available) missingModes.push('prose');
      if (resolvedRunExtractedProse && !idxExtractedProse?.tantivy?.available) {
        missingModes.push('extracted-prose');
      }
      if (runRecords && !idxRecords?.tantivy?.available) missingModes.push('records');
      if (missingModes.length) {
        throw new Error(`Tantivy index missing for mode(s): ${missingModes.join(', ')}.`);
      }
    },

    resolvePrimaryBackend() {
      return useSqlite ? 'sqlite' : (useLmdb ? 'lmdb' : 'cached');
    }
  };
}
