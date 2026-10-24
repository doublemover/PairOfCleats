import path from 'node:path';
import { spawnSubprocessSync } from '../../../shared/subprocess/runner.js';
import { pathExists } from '../../../shared/file-read.js';
import { MAX_JSON_BYTES } from '../../../shared/artifact-io/constants.js';
import { readJsonFile } from '../../../shared/artifact-io/json.js';
import { tryRequire } from '../../../shared/optional-deps.js';
import { hasTantivyAdapter } from '../../sparse/providers/tantivy-adapter.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../../shared/tantivy.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../shared/dict-utils.js';
import { loadIndex } from '../../cli-index.js';
import { loadIndexCached } from '../index-loader.js';
import { EMPTY_INDEX } from '../filter-index.js';
import { filterRepresentationIdentity } from '../../pipeline/filter-enumeration.js';
import { readFilterMatchPage } from '../../pipeline/filter-enumeration-cache.js';

export function createIndexBackendLoader({
  filterOnly = false,
  filterEnumeration = null,
  filterTopN = null,
  signal = null,
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
  generationContext = null,
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
  const needsAnnArtifacts = !filterOnly && (hasRequirements ? requiredArtifacts.has('ann') : true);
  const needsFilterIndex = !filterOnly && (hasRequirements ? requiredArtifacts.has('filterIndex') : true);
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
    if (!hasTantivyAdapter(dep.mod)) throw new Error('Tantivy backend requested but its module has no compatible synchronous open/search adapter.');
  }

  const loadIndexCachedLocal = async (dir, options = {}, mode = null) => {
    const started = performance.now();
    let metadataLoadedRows = 0;
    const result = await loadIndexCached({
      indexCache,
      dir,
      generationTag: generationContext && mode
        ? {
          mode,
          buildId: generationContext.buildId || null,
          buildGenerationKey: generationContext.buildGenerationKey || null,
          activeBuildRoot: generationContext.activeBuildRoot || null
        }
        : null,
      modelIdDefault,
      fileChargramN,
      strict,
      includeHnsw: options.includeHnsw !== false,
      includeDense: options.includeDense !== false,
      includeMinhash: options.includeMinhash !== false,
      includeFilterIndex: options.includeFilterIndex !== false,
      includeTokenIndex: options.includeTokenIndex !== false,
      includeFileRelations: options.includeFileRelations !== false,
      includeRepoMap: options.includeRepoMap !== false,
      includeChunkMetaCold: options.includeChunkMetaCold !== false,
      hnswConfig,
      denseVectorMode: resolvedDenseVectorMode,
      loadIndex: async (targetDir, loadOptions) => {
        const loaded = await loadIndex(targetDir, {
          ...loadOptions, strict, mode, denseVectorMode: resolvedDenseVectorMode
        });
        metadataLoadedRows += loaded.chunkMeta.length;
        return loaded;
      }
    });
    return { ...result, filterLoadCost: { kind: metadataLoadedRows ? 'artifact-materialization' : 'index-cache-reuse',
      metadataLoadedRows, elapsedMs: performance.now() - started,
      tokenIndexLoaded: metadataLoadedRows > 0 && options.includeTokenIndex !== false,
      filterIndexBuilt: metadataLoadedRows > 0 && options.includeFilterIndex !== false } };
  };

  const emptyIndex = () => ({ ...EMPTY_INDEX });
  const baseBackendLoadOptions = {
    includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex,
    includeTokenIndex: !filterOnly
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
      allowSqliteFallback = false,
      skipFilterSnapshot = false
    }) {
      if (!run) return emptyIndex();
      if (!skipFilterSnapshot && backend !== 'sqlite' && filterEnumeration
        && Number.isSafeInteger(filterTopN) && filterTopN > 0
        && !needsFileRelations && !needsRepoMap && !needsGraphRelations) {
        const started = performance.now();
        const page = await readFilterMatchPage({ cacheDir: filterEnumeration.cacheDir,
          identity: filterRepresentationIdentity(filterEnumeration, mode),
          offset: filterEnumeration.offsets[mode] || 0, limit: filterTopN, includeRows: true,
          throwIfAborted: () => signal?.throwIfAborted() });
        if (page?.rows) {
          const chunkMeta = new Array(page.rowCount);
          for (let i = 0; i < page.ids.length; i++) chunkMeta[page.ids[i]] = page.rows[i];
          const cost = { kind: 'authenticated-metadata-seek-page', metadataLoadedRows: page.rows.length,
            elapsedMs: performance.now() - started, tokenIndexLoaded: false, filterIndexBuilt: false };
          return { ...emptyIndex(), chunkMeta, preparedFilterPage: page, filterLoadCost: cost,
            loadFilterMetadata: async () => {
              const full = await this.loadModeIndex({ mode, run, dir, backend, modeLoadOptions,
                allowSqliteFallback, skipFilterSnapshot: true });
              for (let id = 0; id < full.chunkMeta.length; id++) {
                if (id % 256 === 0) { await new Promise(resolve => setImmediate(resolve)); signal?.throwIfAborted(); }
                chunkMeta[id] = full.chunkMeta[id];
              }
              cost.kind = 'metadata-seek-fallback-materialization';
              cost.metadataLoadedRows += full.chunkMeta.length;
              cost.elapsedMs = performance.now() - started;
            } };
        }
      }
      if (backend === 'sqlite') {
        const started = performance.now();
        if (filterEnumeration && Number.isSafeInteger(filterTopN) && filterTopN > 0) {
          try {
            const lazy = loadIndexFromSqlite(mode, { ...sqliteBackendLoadOptions, includeChunks: false });
            const persisted = await readFilterMatchPage({ cacheDir: filterEnumeration.cacheDir,
              identity: filterRepresentationIdentity(filterEnumeration, mode), rowCount: lazy.chunkMeta.length,
              offset: filterEnumeration.offsets[mode] || 0, limit: filterTopN, throwIfAborted: () => signal?.throwIfAborted() });
            const page = persisted || await lazy.loadFilterFactPage?.({ filters: filterEnumeration.filters,
              offset: filterEnumeration.offsets[mode] || 0, limit: filterTopN, signal });
            if (page) {
              lazy.loadChunkMetaByIds(mode, Array.from(page.ids), lazy.chunkMeta);
              if (page.ids.every(id => lazy.chunkMeta[id])) {
                const cost = { kind: page.representation === 'sqlite-indexed-facts' ? 'sqlite-indexed-filter-page' : 'sqlite-seek-page',
                  metadataLoadedRows: page.ids.length, elapsedMs: performance.now() - started,
                  tokenIndexLoaded: false, filterIndexBuilt: false };
                return { ...lazy, preparedFilterPage: page, filterLoadCost: cost,
                  loadFilterMetadata: async () => {
                    const full = loadIndexFromSqlite(mode, { ...sqliteBackendLoadOptions, includeChunks: true }), all = full.chunkMeta;
                    for (let id = 0; id < all.length; id += 1) {
                      if (id % 256 === 0) { await new Promise(resolve => setImmediate(resolve)); signal?.throwIfAborted(); }
                      lazy.chunkMeta[id] = all[id];
                    }
                    cost.kind = 'sqlite-seek-fallback-materialization'; cost.metadataLoadedRows += full.metadataLoadedRows;
                    cost.elapsedMs = performance.now() - started;
                  } };
              }
            }
          } catch (error) {
            signal?.throwIfAborted();
            if (!allowSqliteFallback) throw error;
            return loadCachedModeIndex(mode, dir, modeLoadOptions);
          }
        }
        const loadSqlite = () => {
          const loaded = loadIndexFromSqlite(mode, sqliteBackendLoadOptions);
          return { ...loaded, filterLoadCost: { kind: 'sqlite-materialization', metadataLoadedRows: loaded.metadataLoadedRows,
            elapsedMs: performance.now() - started, tokenIndexLoaded: false, filterIndexBuilt: needsFilterIndex } };
        };
        if (allowSqliteFallback) {
          try {
            return loadSqlite();
          } catch {
            return loadCachedModeIndex(mode, dir, modeLoadOptions);
          }
        }
        return loadSqlite();
      }
      if (backend === 'lmdb') {
        const started = performance.now();
        const loaded = loadIndexFromLmdb(mode, lmdbBackendLoadOptions);
        return { ...loaded, filterLoadCost: { kind: 'lmdb-artifact-materialization', metadataLoadedRows: loaded.chunkMeta.length,
          elapsedMs: performance.now() - started, tokenIndexLoaded: !filterOnly, filterIndexBuilt: needsFilterIndex } };
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
