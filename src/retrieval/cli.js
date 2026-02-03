import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAdaptiveDictConfig,
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getDictConfig,
  getAutoPolicy,
  getRepoRoot,
  getMetricsDir,
  getQueryCacheDir,
  getModelConfig,
  loadUserConfig,
  resolveLmdbPaths,
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { queryVectorAnn } from '../../tools/vector-extension.js';
import { createError, ERROR_CODES, isErrorCode } from '../shared/error-codes.js';
import { getSearchUsage, parseSearchArgs } from './cli-args.js';
import { loadDictionary } from './cli-dictionary.js';
import { getIndexSignature, resolveIndexDir } from './cli-index.js';
import { isLmdbReady, isSqliteReady, loadIndexState } from './cli/index-state.js';
import { configureOutputCaches } from './output.js';
import { createSearchTelemetry } from './cli/telemetry.js';
import { getMissingFlagMessages, resolveIndexedFileCount } from './cli/options.js';
import { evaluateAutoSqliteThresholds, resolveIndexStats } from './cli/auto-sqlite.js';
import { hasLmdbStore } from './cli/index-loader.js';
import { applyBranchFilter } from './cli/branch-filter.js';
import { createBackendContext } from './cli/backend-context.js';
import { color } from './cli/ansi.js';
import { resolveBackendSelection } from './cli/policy.js';
import { normalizeSearchOptions } from './cli/normalize-options.js';
import { buildQueryPlan } from './cli/query-plan.js';
import { createRunnerHelpers, inferJsonOutputFromArgs } from './cli/runner.js';
import { resolveRunConfig } from './cli/resolve-run-config.js';
import { loadSearchIndexes } from './cli/load-indexes.js';
import { runSearchSession } from './cli/run-search-session.js';
import { renderSearchOutput } from './cli/render.js';
import { recordSearchArtifacts } from './cli/persist.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../shared/code-dictionaries.js';
import {
  buildQueryPlanCacheKey,
  buildQueryPlanConfigSignature,
  buildQueryPlanIndexSignature,
  createQueryPlanCache,
  createQueryPlanEntry
} from './query-plan-cache.js';
import { createRetrievalStageTracker } from './pipeline/stage-checkpoints.js';

const defaultQueryPlanCache = createQueryPlanCache();


export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const telemetry = createSearchTelemetry();
  const recordSearchMetrics = (status) => telemetry.record(status);
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const indexCache = options.indexCache || null;
  const sqliteCache = options.sqliteCache || null;
  const queryPlanCache = options.queryPlanCache ?? defaultQueryPlanCache;
  const signal = options.signal || null;
  const scoreModeOverride = options.scoreMode ?? null;
  const t0 = Date.now();

  if (signal?.aborted) {
    const err = createError(ERROR_CODES.INVALID_REQUEST, 'Search aborted.');
    err.code = 'ERR_ABORTED';
    throw err;
  }
  let argv;
  try {
    argv = parseSearchArgs(rawArgs);
  } catch (err) {
    recordSearchMetrics('error');
    const { jsonOutput } = inferJsonOutputFromArgs(rawArgs);
    const message = err && typeof err.message === 'string' && err.message.trim()
      ? err.message
      : 'Invalid arguments.';

    if (emitOutput) {
      if (jsonOutput) {
        console.log(JSON.stringify({ ok: false, code: ERROR_CODES.INVALID_REQUEST, message }));
      } else {
        console.error(message);
      }
    }

    if (exitOnError) process.exit(1);

    const error = createError(ERROR_CODES.INVALID_REQUEST, message);
    error.emitted = true;
    error.cause = err;
    throw error;
  }

  const jsonOutput = argv.json === true;
  const jsonCompact = argv.compact === true;
  const rootOverride = options.root ? path.resolve(options.root) : null;
  const rootArg = rootOverride || (argv.repo ? path.resolve(argv.repo) : null);
  const rootDir = getRepoRoot(rootArg);
  const userConfig = loadUserConfig(rootDir);
  const cacheConfig = getCacheRuntimeConfig(rootDir, userConfig);
  const verboseCache = false;
  const cacheLog = verboseCache ? (msg) => process.stderr.write(`\n${msg}\n`) : null;

  configureOutputCaches({ cacheConfig, verbose: verboseCache, log: cacheLog });

  const { bail, throwIfAborted } = createRunnerHelpers({
    emitOutput,
    exitOnError,
    jsonOutput,
    recordSearchMetrics,
    signal
  });

  try {
    throwIfAborted();
    const missingValueMessages = getMissingFlagMessages(argv, rawArgs);
    if (missingValueMessages.length) {
      return bail(missingValueMessages.join('\n'), 1, ERROR_CODES.INVALID_REQUEST);
    }

    const metricsDir = getMetricsDir(rootDir, userConfig);
    const queryCacheDir = getQueryCacheDir(rootDir, userConfig);
    const policy = await getAutoPolicy(rootDir, userConfig);
    let normalized;
    try {
      normalized = normalizeSearchOptions({
        argv,
        rawArgs,
        rootDir,
        userConfig,
        metricsDir,
        queryCacheDir,
        policy
      });
    } catch (err) {
      return bail(err.message, 1, ERROR_CODES.INVALID_REQUEST);
    }
    throwIfAborted();

    if (normalized.missingValueMessages.length) {
      return bail(normalized.missingValueMessages.join('\n'), 1, ERROR_CODES.INVALID_REQUEST);
    }

    const runConfig = resolveRunConfig({ normalized, scoreModeOverride });

    const {
      query,
      searchType,
      searchAuthor,
      searchImport,
      chunkAuthorFilter,
      searchMode,
      runCode,
      runProse,
      runRecords,
      runExtractedProse: runExtractedProseRaw,
      commentsEnabled,
      embeddingProvider,
      embeddingOnnx,
      hnswConfig,
      sqliteAutoChunkThreshold,
      sqliteAutoArtifactBytes,
      postingsConfig,
      filePrefilterEnabled,
      searchRegexConfig,
      fileChargramN,
      vectorExtension,
      annBackend,
      bm25K1,
      bm25B,
      branchesMin,
      loopsMin,
      breaksMin,
      continuesMin,
      churnMin,
      modifiedAfter,
      modifiedSinceDays,
      fileFilter,
      caseFile,
      caseTokens,
      branchFilter,
      extFilter,
      langFilter,
      extImpossible,
      langImpossible,
      metaFilters,
      annEnabled,
      scoreBlendEnabled,
      scoreBlendSparseWeight,
      scoreBlendAnnWeight,
      symbolBoostEnabled,
      symbolBoostDefinitionWeight,
      symbolBoostExportWeight,
      minhashMaxDocs,
      maxCandidates,
      queryCacheEnabled,
      queryCacheMaxEntries,
      queryCacheTtlMs,
      rrfEnabled,
      rrfK,
      graphRankingConfig,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      fieldWeightsConfig,
      explain,
      denseVectorMode,
      strict,
      backendArg,
      lancedbConfig,
      tantivyConfig,
      sparseBackend
    } = runConfig;

    if (!query) {
      return bail(getSearchUsage(), 1, ERROR_CODES.INVALID_REQUEST);
    }

    telemetry.setMode(searchMode);
    telemetry.setAnn(annEnabled ? 'on' : 'off');

    const modelConfig = getModelConfig(rootDir, userConfig);
    const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
    const useStubEmbeddings = argv['stub-embeddings'] === true;
    const topN = argv.n;
    const showStats = argv.stats === true;
    const showMatched = argv.matched === true;
    const stageTracker = createRetrievalStageTracker({ enabled: showStats || explain });

    const needsCode = runCode;
    const needsProse = runProse;
    const needsSqlite = runCode || runProse;
    const vectorAnnEnabled = annEnabled && vectorExtension.enabled;

    const lmdbPaths = resolveLmdbPaths(rootDir, userConfig);
    const lmdbCodePath = lmdbPaths.codePath;
    const lmdbProsePath = lmdbPaths.prosePath;
    const sqlitePaths = resolveSqlitePaths(rootDir, userConfig);
    const sqliteCodePath = sqlitePaths.codePath;
    const sqliteProsePath = sqlitePaths.prosePath;

    const sqliteStateCode = needsCode ? loadIndexState(rootDir, userConfig, 'code') : null;
    const sqliteStateProse = needsProse ? loadIndexState(rootDir, userConfig, 'prose') : null;
    const sqliteCodeAvailable = fsSync.existsSync(sqliteCodePath) && isSqliteReady(sqliteStateCode);
    const sqliteProseAvailable = fsSync.existsSync(sqliteProsePath) && isSqliteReady(sqliteStateProse);
    const sqliteAvailable = (!needsCode || sqliteCodeAvailable) && (!needsProse || sqliteProseAvailable);
    const lmdbStateCode = sqliteStateCode;
    const lmdbStateProse = sqliteStateProse;
    const lmdbCodeAvailable = hasLmdbStore(lmdbCodePath) && isLmdbReady(lmdbStateCode);
    const lmdbProseAvailable = hasLmdbStore(lmdbProsePath) && isLmdbReady(lmdbStateProse);
    const lmdbAvailable = (!needsCode || lmdbCodeAvailable) && (!needsProse || lmdbProseAvailable);

    const autoChunkThreshold = Number.isFinite(sqliteAutoChunkThreshold)
      ? Math.max(0, Math.floor(sqliteAutoChunkThreshold))
      : 0;
    const autoArtifactThreshold = Number.isFinite(sqliteAutoArtifactBytes)
      ? Math.max(0, Math.floor(sqliteAutoArtifactBytes))
      : 0;
    const autoThresholdsEnabled = autoChunkThreshold > 0 || autoArtifactThreshold > 0;
    const autoBackendRequested = !backendArg || String(backendArg).trim().toLowerCase() === 'auto';
    let autoSqliteAllowed = true;
    let autoSqliteReason = null;
    if (autoThresholdsEnabled && autoBackendRequested && sqliteAvailable && needsSqlite) {
      const stats = [];
      if (runCode) {
        stats.push({ mode: 'code', ...resolveIndexStats(resolveIndexDir(rootDir, 'code', userConfig)) });
      }
      if (runProse) {
        stats.push({ mode: 'prose', ...resolveIndexStats(resolveIndexDir(rootDir, 'prose', userConfig)) });
      }
      if (runExtractedProseRaw) {
        stats.push({
          mode: 'extracted-prose',
          ...resolveIndexStats(resolveIndexDir(rootDir, 'extracted-prose', userConfig))
        });
      }
      const evaluation = evaluateAutoSqliteThresholds({
        stats,
        chunkThreshold: autoChunkThreshold,
        artifactThreshold: autoArtifactThreshold
      });
      if (!evaluation.allowed) {
        autoSqliteAllowed = false;
        autoSqliteReason = evaluation.reason;
      }
    }

    const backendSelection = await resolveBackendSelection({
      backendArg,
      sqliteAvailable,
      sqliteCodeAvailable,
      sqliteProseAvailable,
      sqliteCodePath,
      sqliteProsePath,
      lmdbAvailable,
      lmdbCodeAvailable,
      lmdbProseAvailable,
      lmdbCodePath,
      lmdbProsePath,
      needsSqlite,
      needsCode,
      needsProse,
      defaultBackend: policy?.retrieval?.backend || 'sqlite',
      onWarn: console.warn
    });
    if (backendSelection.error) {
      return bail(backendSelection.error.message);
    }

    let {
      backendPolicy,
      useSqlite: useSqliteSelection,
      useLmdb: useLmdbSelection,
      sqliteFtsRequested,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedTantivy
    } = backendSelection;
    if (!autoSqliteAllowed && autoBackendRequested && useSqliteSelection && !backendForcedSqlite) {
      useSqliteSelection = false;
      useLmdbSelection = false;
      if (autoSqliteReason) {
        backendPolicy = backendPolicy ? { ...backendPolicy, reason: autoSqliteReason } : backendPolicy;
        if (emitOutput) {
          console.warn(`[search] ${autoSqliteReason}. Falling back to file-backed indexes.`);
        }
      }
    }
    const sqliteFtsEnabled = sqliteFtsRequested || (autoBackendRequested && useSqliteSelection);

    const backendContext = await createBackendContext({
      backendPolicy,
      useSqlite: useSqliteSelection,
      useLmdb: useLmdbSelection,
      needsCode,
      needsProse,
      sqliteCodePath,
      sqliteProsePath,
      sqliteFtsRequested: sqliteFtsEnabled,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedTantivy,
      vectorExtension,
      vectorAnnEnabled,
      dbCache: sqliteCache,
      sqliteStates: {
        code: sqliteStateCode,
        prose: sqliteStateProse
      },
      lmdbCodePath,
      lmdbProsePath,
      lmdbStates: {
        code: lmdbStateCode,
        prose: lmdbStateProse
      },
      postingsConfig,
      sqliteFtsWeights,
      maxCandidates,
      queryVectorAnn,
      modelIdDefault,
      fileChargramN,
      hnswConfig,
      denseVectorMode,
      root: rootDir,
      userConfig
    });

    const {
      useSqlite,
      useLmdb,
      backendLabel,
      backendPolicyInfo,
      vectorAnnState,
      vectorAnnUsed,
      sqliteHelpers,
      lmdbHelpers
    } = backendContext;
    telemetry.setBackend(backendLabel);
    if (backendForcedLmdb && !useLmdb) {
      return bail('LMDB backend requested but unavailable.', 1, ERROR_CODES.INVALID_REQUEST);
    }

    const branchResult = await applyBranchFilter({
      branchFilter,
      caseSensitive: caseFile,
      root: rootDir,
      metricsDir,
      queryCacheDir,
      runCode,
      runProse,
      backendLabel,
      backendPolicy: backendPolicyInfo,
      emitOutput,
      jsonOutput,
      recordSearchMetrics,
      warn: console.warn
    });
    if (branchResult?.payload) {
      return branchResult.payload;
    }

    const dictConfigBase = getDictConfig(rootDir, userConfig);
    const dictConfig = applyAdaptiveDictConfig(
      dictConfigBase,
      resolveIndexedFileCount(metricsDir, {
        runCode,
        runProse,
        runExtractedProse: runExtractedProseRaw,
        runRecords
      })
    );
    const baseCodeDictLanguages = normalizeCodeDictLanguages(DEFAULT_CODE_DICT_LANGUAGES);
    let codeDictLanguages = baseCodeDictLanguages;
    if (langFilter && langFilter.length) {
      const filterLangs = normalizeCodeDictLanguages(langFilter);
      if (filterLangs.size) {
        const intersect = new Set();
        for (const lang of baseCodeDictLanguages) {
          if (filterLangs.has(lang)) intersect.add(lang);
        }
        codeDictLanguages = intersect;
      }
    }
    const includeCodeDicts = runCode && codeDictLanguages.size > 0;
    const { dict } = await loadDictionary(rootDir, dictConfig, {
      includeCode: includeCodeDicts,
      codeDictLanguages: Array.from(codeDictLanguages)
    });
    throwIfAborted();

    const joinComments = commentsEnabled && runCode;
    const planConfigSignature = queryPlanCache?.enabled !== false
      ? buildQueryPlanConfigSignature({
        dictConfig,
        dictSize: dict?.size ?? null,
        postingsConfig,
        caseTokens,
        fileFilter,
        caseFile,
        searchRegexConfig,
        filePrefilterEnabled,
        fileChargramN,
        searchType,
        searchAuthor,
        searchImport,
        chunkAuthorFilter,
        branchesMin,
        loopsMin,
        breaksMin,
        continuesMin,
        churnMin,
        extFilter,
        langFilter,
        extImpossible,
        langImpossible,
        metaFilters,
        modifiedAfter,
        modifiedSinceDays,
        fieldWeightsConfig,
        denseVectorMode,
        branchFilter
      })
      : null;
    if (planConfigSignature) {
      queryPlanCache.resetIfConfigChanged(planConfigSignature);
    }
    const planIndexSignature = planConfigSignature
      ? buildQueryPlanIndexSignature(getIndexSignature({
        useSqlite,
        backendLabel,
        sqliteCodePath,
        sqliteProsePath,
        runRecords,
        runExtractedProse: runExtractedProseRaw,
        includeExtractedProse: runExtractedProseRaw || joinComments,
        root: rootDir,
        userConfig
      }))
      : null;
    const planCacheKeyInfo = planConfigSignature
      ? buildQueryPlanCacheKey({
        query,
        configSignature: planConfigSignature,
        indexSignature: planIndexSignature
      })
      : null;
    const cachedPlanEntry = planCacheKeyInfo
      ? queryPlanCache.get(planCacheKeyInfo.key, {
        configSignature: planConfigSignature,
        indexSignature: planIndexSignature
      })
      : null;
    const parseStart = stageTracker.mark();
    const queryPlan = cachedPlanEntry?.plan || buildQueryPlan({
      query,
      argv,
      dict,
      dictConfig,
      postingsConfig,
      caseTokens,
      fileFilter,
      caseFile,
      searchRegexConfig,
      filePrefilterEnabled,
      fileChargramN,
      searchType,
      searchAuthor,
      searchImport,
      chunkAuthorFilter,
      branchesMin,
      loopsMin,
      breaksMin,
      continuesMin,
      churnMin,
      extFilter,
      langFilter,
      extImpossible,
      langImpossible,
      metaFilters,
      modifiedAfter,
      modifiedSinceDays,
      fieldWeightsConfig,
      denseVectorMode,
      branchFilter
    });
    stageTracker.record('parse', parseStart, { mode: 'all' });
    if (!cachedPlanEntry && planCacheKeyInfo && planConfigSignature) {
      queryPlanCache.set(
        planCacheKeyInfo.key,
        createQueryPlanEntry({
          plan: queryPlan,
          configSignature: planConfigSignature,
          indexSignature: planIndexSignature,
          keyPayload: planCacheKeyInfo.payload
        })
      );
    }

    const annActive = annEnabled && queryPlan.queryTokens.length > 0;

    const {
      loadIndexFromSqlite,
      buildCandidateSetSqlite,
      getTokenIndexForQuery,
      rankSqliteFts,
      rankVectorAnnSqlite
    } = sqliteHelpers;
    const { loadIndexFromLmdb } = lmdbHelpers;

    const {
      idxProse,
      idxExtractedProse,
      idxCode,
      idxRecords,
      runExtractedProse,
      extractedProseLoaded,
      hnswAnnState,
      hnswAnnUsed,
      lanceAnnState,
      lanceAnnUsed,
      modelIdForCode,
      modelIdForProse,
      modelIdForExtractedProse,
      modelIdForRecords
    } = await loadSearchIndexes({
      rootDir,
      userConfig,
      searchMode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      runCode,
      runRecords,
      useSqlite,
      useLmdb,
      emitOutput,
      exitOnError,
      annActive,
      filtersActive: queryPlan.filtersActive,
      contextExpansionEnabled,
      graphRankingEnabled: graphRankingConfig?.enabled === true,
      sqliteFtsRequested: sqliteFtsEnabled,
      backendLabel,
      backendForcedTantivy,
      indexCache,
      modelIdDefault,
      fileChargramN,
      hnswConfig,
      lancedbConfig,
      tantivyConfig,
      indexStates: {
        code: sqliteStateCode || null,
        prose: sqliteStateProse || null
      },
      strict,
      loadIndexFromSqlite,
      loadIndexFromLmdb,
      resolvedDenseVectorMode: queryPlan.resolvedDenseVectorMode,
      loadExtractedProse: joinComments
    });
    throwIfAborted();

    const modelIds = {
      code: modelIdForCode,
      prose: modelIdForProse,
      extractedProse: modelIdForExtractedProse,
      records: modelIdForRecords
    };

    const searchResult = await runSearchSession({
      rootDir,
      userConfig,
      metricsDir,
      queryCacheDir,
      query,
      searchMode,
      runCode,
      runProse,
      runExtractedProse,
      runRecords,
      commentsEnabled: joinComments,
      extractedProseLoaded,
      topN,
      useSqlite,
      annEnabled,
      annActive,
      annBackend,
      lancedbConfig,
      vectorExtension,
      vectorAnnEnabled,
      vectorAnnState,
      vectorAnnUsed,
      hnswConfig,
      hnswAnnState,
      hnswAnnUsed,
      lanceAnnState,
      lanceAnnUsed,
      sqliteFtsRequested: sqliteFtsEnabled,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      sqliteCodePath,
      sqliteProsePath,
      bm25K1,
      bm25B,
      fieldWeights: queryPlan.fieldWeights,
      postingsConfig,
      queryTokens: queryPlan.queryTokens,
      queryAst: queryPlan.queryAst,
      phraseNgramSet: queryPlan.phraseNgramSet,
      phraseRange: queryPlan.phraseRange,
      symbolBoost: {
        enabled: symbolBoostEnabled,
        definitionWeight: symbolBoostDefinitionWeight,
        exportWeight: symbolBoostExportWeight
      },
      maxCandidates,
      filters: queryPlan.filters,
      filtersActive: queryPlan.filtersActive,
      explain,
      scoreBlend: {
        enabled: scoreBlendEnabled,
        sparseWeight: scoreBlendSparseWeight,
        annWeight: scoreBlendAnnWeight
      },
      rrf: {
        enabled: rrfEnabled,
        k: rrfK
      },
      graphRankingConfig,
      minhashMaxDocs,
      sparseBackend,
      buildCandidateSetSqlite,
      getTokenIndexForQuery,
      rankSqliteFts,
      rankVectorAnnSqlite,
      sqliteHasFts: sqliteHelpers?.hasFtsTable,
      idxProse,
      idxExtractedProse,
      idxCode,
      idxRecords,
      modelConfig,
      modelIds,
      embeddingProvider,
      embeddingOnnx,
      embeddingQueryText: queryPlan.embeddingQueryText,
      useStubEmbeddings,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      cacheFilters: queryPlan.cacheFilters,
      queryCacheEnabled,
      queryCacheMaxEntries,
      queryCacheTtlMs,
      backendLabel,
      resolvedDenseVectorMode: queryPlan.resolvedDenseVectorMode,
      intentInfo: queryPlan.intentInfo,
      signal,
      stageTracker
    });

    const elapsedMs = Date.now() - t0;

    const payload = renderSearchOutput({
      emitOutput,
      jsonOutput,
      jsonCompact,
      explain,
      color,
      rootDir,
      backendLabel,
      backendPolicyInfo,
      runCode,
      runProse,
      runExtractedProse,
      runRecords,
      topN,
      queryTokens: queryPlan.queryTokens,
      highlightRegex: queryPlan.highlightRegex,
      contextExpansionEnabled,
      expandedHits: {
        prose: searchResult.proseExpanded,
        extractedProse: searchResult.extractedProseExpanded,
        code: searchResult.codeExpanded,
        records: searchResult.recordExpanded
      },
      baseHits: {
        proseHits: searchResult.proseHits,
        extractedProseHits: searchResult.extractedProseHits,
        codeHits: searchResult.codeHits,
        recordHits: searchResult.recordHits
      },
      annEnabled,
      annActive,
      annBackend: searchResult.annBackend,
      vectorExtension,
      vectorAnnEnabled,
      vectorAnnState,
      vectorAnnUsed,
      hnswConfig,
      hnswAnnState,
      lanceAnnState,
      modelIds,
      embeddingProvider,
      embeddingOnnx,
      cacheInfo: searchResult.cache,
      intentInfo: queryPlan.intentInfo,
      resolvedDenseVectorMode: queryPlan.resolvedDenseVectorMode,
      fieldWeights: queryPlan.fieldWeights,
      contextExpansionStats: searchResult.contextExpansionStats,
      idxProse,
      idxExtractedProse,
      idxCode,
      idxRecords,
      showStats,
      showMatched,
      verboseCache,
      elapsedMs,
      stageTracker
    });

    await recordSearchArtifacts({
      metricsDir,
      query,
      queryTokens: queryPlan.queryTokens,
      proseHits: searchResult.proseHits,
      extractedProseHits: searchResult.extractedProseHits,
      codeHits: searchResult.codeHits,
      recordHits: searchResult.recordHits,
      elapsedMs,
      cacheHit: searchResult.cache.hit
    });

    recordSearchMetrics('ok');
    return payload;
  } catch (err) {
    recordSearchMetrics('error');
    if (emitOutput && jsonOutput && !err?.emitted) {
      let message = err?.message || 'Search failed.';
      if (err?.code && String(err.code).startsWith('ERR_MANIFEST')
        && !String(message).toLowerCase().includes('manifest')) {
        message = message && message !== 'Search failed.'
          ? `Manifest error: ${message}`
          : 'Missing pieces manifest.';
      }
      const code = isErrorCode(err?.code) ? err.code : ERROR_CODES.INTERNAL;
      console.log(JSON.stringify({ ok: false, code, message }));
      if (err) err.emitted = true;
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
