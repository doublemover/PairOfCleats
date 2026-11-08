import path from 'node:path';
import { spawnSubprocess } from '../../../shared/subprocess/runner.js';
import { tryRequire } from '../../../shared/optional-deps.js';
import { hasTantivyAdapter } from '../../sparse/providers/tantivy-adapter.js';
import { normalizeTantivyConfig } from '../../../shared/tantivy.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../shared/dict-utils.js';
import { loadIndex } from '../../cli-index.js';
import { loadIndexCached } from '../index-loader.js';
import { EMPTY_INDEX } from '../filter-index.js';
import { filterRepresentationIdentity } from '../../pipeline/filter-enumeration.js';
import { readFilterMatchPage } from '../../pipeline/filter-enumeration-cache.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

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
  relationFilters = null,
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
  const demandedRelationFields = Boolean(relationFilters?.importName || relationFilters?.uses);
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
    // Required predicate evidence is loaded after inspecting inline facts.
    // An unrelated optional sidecar must not defeat complete inline evidence.
    includeFileRelations: needsFileRelations && !demandedRelationFields,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
  };
  const loadCachedModeIndex = (mode, dir, modeLoadOptions = cachedLoadOptions) => (
    loadIndexCachedLocal(dir, modeLoadOptions, mode)
  );

  const resolveTantivyAvailability = async (mode, indexDir, idx) => {
    if (!tantivyEnabled || !indexDir) {
      return { dir: null, metaPath: null, meta: null, available: false };
    }
    const [{ createTantivySource, readTantivyManifest }, { readTantivyReceipt },
      { withTantivyStorage }, { observeStorageResource }] = await Promise.all([
      import('../../../shared/tantivy-source.js'), import('../../../shared/tantivy-receipt.js'),
      import('../../../shared/tantivy-storage.js'), import('../../../shared/storage/failure-observation.js')
    ]);
    return withTantivyStorage(indexDir, { repoRoot: rootDir, userConfig, env: runtimeEnv }, async () => {
      let selected, source;
      try {
        selected = await readTantivyManifest(indexDir, { repoRoot: rootDir, signal });
        source = await createTantivySource({ repoRoot: rootDir, indexDir, mode, signal,
          manifestSha256: selected.sha256, chunkMeta: idx.chunkMeta, tokenPostings: idx.tokenIndex });
        if ((await readTantivyManifest(indexDir, { repoRoot: rootDir, signal })).sha256 !== selected.sha256) {
          throw Object.assign(new Error('Tantivy source changed during attachment.'), { code: 'ERR_TANTIVY_SOURCE' });
        }
      } catch (error) {
        observeStorageResource(error, { phase: 'tantivy-source-admission' }).requireSettled();
        if (!['ERR_TANTIVY_SOURCE', 'ENOENT'].includes(error?.code)) throw error;
        return { dir: null, metaPath: null, meta: null, available: false, reason: 'source-identity-unavailable' };
      }
      return readTantivyReceipt({ indexDir, mode, config: resolvedTantivyConfig, source, signal });
    });
  };

  const ensureTantivyIndex = async (mode, indexDir, idx) => {
    if (tantivyRequired && resolvedTantivyConfig.autoBuild && path.basename(indexDir) !== `index-${mode}`) {
      throw Object.assign(new Error(`Tantivy source layout is not canonical for mode=${mode}.`), { code: 'ERR_TANTIVY_SOURCE_LAYOUT' });
    }
    const availability = await resolveTantivyAvailability(mode, indexDir, idx);
    if (availability.available) return availability;
    if (!tantivyRequired || !resolvedTantivyConfig.autoBuild) return availability;
    const toolRoot = resolveToolRoot();
    const scriptPath = path.join(toolRoot, 'tools', 'build/tantivy-index.js');
    // Preserve the immutable source already selected by this request. A child
    // resolving latest again can build a different generation than its reader.
    if (path.basename(indexDir) !== `index-${mode}`) {
      throw Object.assign(new Error(`Tantivy source layout is not canonical for mode=${mode}.`), {
        code: 'ERR_TANTIVY_SOURCE_LAYOUT'
      });
    }
    const result = await spawnSubprocess(
      process.execPath,
      [scriptPath, '--mode', mode, '--repo', rootDir, '--index-root', path.dirname(indexDir)],
      {
        stdio: emitOutput ? 'inherit' : 'ignore',
        rejectOnNonZeroExit: false,
        env: runtimeEnv,
        signal
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Tantivy index build failed for mode=${mode}.`);
    }
    return resolveTantivyAvailability(mode, indexDir, idx);
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
        if (filterEnumeration && !needsFileRelations && Number.isSafeInteger(filterTopN) && filterTopN > 0) {
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
            observeStorageResource(error, { phase: 'sqlite-filter-page-fallback' }).requireSettled();
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
          } catch (error) {
            observeStorageResource(error, { phase: 'sqlite-index-fallback' }).requireSettled();
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
      const availability = await ensureTantivyIndex(mode, dir, idx);
      idx.tantivy = {
        dir: availability.dir,
        metaPath: availability.metaPath,
        meta: availability.meta,
        available: availability.available,
        reason: availability.reason
      };
      Object.defineProperty(idx.tantivy, 'storageContext', {
        value: { repoRoot: rootDir, userConfig, env: runtimeEnv }
      });
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
