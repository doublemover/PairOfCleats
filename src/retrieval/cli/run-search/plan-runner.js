import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getAutoPolicy,
  getRepoRoot,
  getMetricsDir,
  getQueryCacheDir,
  getModelConfig,
  loadUserConfig
} from '../../../../tools/shared/dict-utils.js';
import { queryVectorAnn } from '../../../../tools/sqlite/vector-extension.js';
import { createError, ERROR_CODES } from '../../../shared/error-codes.js';
import { getSearchUsage } from '../../cli-args.js';
import { configureOutputCaches } from '../../output.js';
import { getMissingFlagMessages } from '../options.js';
import { normalizeSearchOptions } from '../normalize-options.js';
import { createRunnerHelpers } from '../runner.js';
import { resolveRunConfig } from '../resolve-run-config.js';
import { resolveRequiredArtifacts } from '../required-artifacts.js';
import { executeSearchAndEmit } from '../search-execution.js';
import { resolveRetrievalCachePath } from '../cache-paths.js';
import {
  createQueryPlanDiskCache
} from '../../query-plan-cache.js';
import { createRetrievalStageTracker } from '../../pipeline/stage-checkpoints.js';
import {
  emitSearchJsonError,
  flushRunSearchResources
} from './reporting.js';
import { createWarningCollector } from './shared.js';
import { createRunSearchTelemetry } from './telemetry.js';
import {
  emitMissingQueryAndThrow,
  extractPositionalQuery,
  extractWorkspacePath,
  parseCliArgsOrThrow,
  runFederatedIfRequested
} from './options.js';
import {
  resolveStartupIndexResolution
} from './startup-index.js';
import { resolveRunSearchIndexAvailability } from './index-availability.js';
import { resolveRunSearchBackendContext } from './backend-bootstrap.js';
import { loadRunSearchIndexesWithTracking } from './index-loading.js';
import { buildQueryPlanInput } from './plan-input.js';
import { resolveRunSearchSparsePreflight } from './sparse-preflight.js';
import { runBranchFilterGate } from './branch-gate.js';
import { resolveRunSearchDictionaryAndPlan } from './query-planning.js';
import { reinitializeBackendAfterSparseFallback } from './backend-reinit.js';
import { enforceSparseFallbackAnnAvailability } from './sparse-fallback-guard.js';

import {
  resolveAnnActive
} from '../preflight.js';

/**
 * Execute the `pairofcleats search` CLI end-to-end: parse flags, load policy
 * and indexes, run retrieval, emit output, and persist telemetry.
 *
 * @param {string[]} [rawArgs]
 * @param {object} [options]
 * @param {boolean} [options.emitOutput]
 * @param {boolean} [options.exitOnError]
 * @param {AbortSignal|null} [options.signal]
 * @param {string|null} [options.scoreMode]
 * @param {object|null} [options.indexCache]
 * @param {object|null} [options.sqliteCache]
 * @param {object|null} [options.queryPlanCache]
 * @param {string|null} [options.root]
 * @returns {Promise<object>}
 */
export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const { telemetry, recordSearchMetrics } = createRunSearchTelemetry();
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const indexCache = options.indexCache || null;
  const sqliteCache = options.sqliteCache || null;
  const signal = options.signal || null;
  const scoreModeOverride = options.scoreMode ?? null;
  const t0 = Date.now();
  let queryPlanCache = options.queryPlanCache ?? null;

  if (signal?.aborted) {
    const err = createError(ERROR_CODES.INVALID_REQUEST, 'Search aborted.');
    err.code = 'ERR_ABORTED';
    throw err;
  }
  const argv = parseCliArgsOrThrow({
    rawArgs,
    emitOutput,
    exitOnError,
    recordSearchMetrics
  });

  const jsonOutput = argv.json === true;
  const jsonCompact = argv.compact === true;
  const positionalQuery = extractPositionalQuery(argv);
  if (!positionalQuery) {
    emitMissingQueryAndThrow({
      jsonOutput,
      emitOutput,
      exitOnError,
      recordSearchMetrics
    });
  }
  const workspacePath = extractWorkspacePath(argv);
  const federatedPayload = await runFederatedIfRequested({
    rawArgs,
    workspacePath,
    signal,
    indexCache,
    sqliteCache,
    emitOutput,
    exitOnError,
    recordSearchMetrics
  });
  if (federatedPayload) {
    return federatedPayload;
  }
  const rootOverride = options.root ? path.resolve(options.root) : null;
  const rootArg = rootOverride || (argv.repo ? path.resolve(argv.repo) : null);
  const rootDir = getRepoRoot(rootArg);
  const userConfig = loadUserConfig(rootDir);
  const cacheConfig = getCacheRuntimeConfig(rootDir, userConfig);
  const verboseCache = false;
  const cacheLog = verboseCache ? (msg) => process.stderr.write(`\n${msg}\n`) : null;

  configureOutputCaches({ cacheConfig, verbose: verboseCache, log: cacheLog });

  const { bail, throwIfAborted, ensureRetrievalHealth } = createRunnerHelpers({
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
    if (!queryPlanCache) {
      const queryPlanCachePath = resolveRetrievalCachePath({
        queryCacheDir,
        metricsDir,
        fileName: 'queryPlanCache.json'
      });
      if (queryPlanCachePath) {
        queryPlanCache = createQueryPlanDiskCache({ path: queryPlanCachePath });
        if (typeof queryPlanCache?.load === 'function') {
          queryPlanCache.load();
        }
      }
    }
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
      annFlagPresent,
      scoreBlendEnabled,
      scoreBlendSparseWeight,
      scoreBlendAnnWeight,
      symbolBoostEnabled,
      symbolBoostDefinitionWeight,
      symbolBoostExportWeight,
      relationBoostEnabled,
      relationBoostPerCall,
      relationBoostPerUse,
      relationBoostMaxBoost,
      annCandidateCap,
      annCandidateMinDocCount,
      annCandidateMaxDocCount,
      minhashMaxDocs,
      maxCandidates,
      storageTier,
      queryCacheEnabled,
      queryCacheMaxEntries,
      queryCacheTtlMs,
      queryCacheStrategy,
      queryCachePrewarm,
      queryCachePrewarmMaxEntries,
      queryCacheMemoryFreshMs,
      rrfEnabled,
      rrfK,
      graphRankingConfig,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      sqliteFtsTrigram,
      sqliteFtsStemming,
      sqliteTailLatencyTuning,
      sqliteFtsOverfetch,
      preferMemoryBackendOnCacheHit,
      sqliteReadPragmas,
      fieldWeightsConfig,
      explain,
      allowSparseFallback,
      allowUnsafeMix,
      denseVectorMode,
      strict,
      backendArg,
      lancedbConfig,
      tantivyConfig,
      sparseBackend,
      scoreMode
    } = runConfig;

    if (!query) {
      return bail(getSearchUsage(), 1, ERROR_CODES.INVALID_REQUEST);
    }

    const startupIndexResolution = await resolveStartupIndexResolution({
      rootDir,
      userConfig,
      runCode,
      runProse,
      runRecords,
      searchMode,
      asOf: argv['as-of'],
      snapshot: argv.snapshot
    });
    if (startupIndexResolution.error) {
      return bail(
        startupIndexResolution.error.message,
        1,
        startupIndexResolution.error.code
      );
    }
    const {
      asOfContext,
      indexResolveOptions,
      resolveSearchIndexDir,
      strictIndexMetaByMode
    } = startupIndexResolution;

    telemetry.setMode(searchMode);

    const modelConfig = getModelConfig(rootDir, userConfig);
    const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
    const useStubEmbeddings = argv['stub-embeddings'] === true;
    const topN = argv.n;
    const showStats = argv.stats === true;
    const showMatched = argv.matched === true;
    const stageTracker = createRetrievalStageTracker({ enabled: showStats || explain });

    const needsCode = runCode;
    const needsProse = runProse;
    const needsExtractedProse = runExtractedProseRaw;
    const requiresExtractedProse = searchMode === 'extracted-prose';
    const joinComments = commentsEnabled && runCode;
    const needsSqlite = runCode || runProse || runExtractedProseRaw;
    let annEnabledEffective = annEnabled;
    let vectorAnnEnabled = false;
    let sparseFallbackForcedByPreflight = false;
    const warningCollector = createWarningCollector();
    const profileWarnings = warningCollector.warnings;
    const addProfileWarning = warningCollector.add;
    const syncAnnFlags = () => {
      vectorAnnEnabled = annEnabledEffective && vectorExtension.enabled === true;
      telemetry.setAnn(annEnabledEffective ? 'on' : 'off');
    };
    const profileAndAvailability = await resolveRunSearchIndexAvailability({
      rootDir,
      userConfig,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      runRecords,
      searchMode,
      asOfContext,
      indexResolveOptions,
      addProfileWarning,
      allowSparseFallback,
      allowUnsafeMix,
      annFlagPresent,
      annEnabled: annEnabledEffective,
      scoreMode
    });
    if (profileAndAvailability.error) {
      return bail(profileAndAvailability.error.message, 1, profileAndAvailability.error.code);
    }
    const {
      selectedModes,
      profilePolicyByMode,
      vectorOnlyModes,
      sqliteRootsMixed,
      lmdbRootsMixed,
      sqlitePaths,
      lmdbPaths,
      sqliteStates: resolvedSqliteStates,
      lmdbStates: resolvedLmdbStates,
      sqliteAvailability,
      lmdbAvailability,
      loadExtractedProseSqlite
    } = profileAndAvailability;
    annEnabledEffective = profileAndAvailability.annEnabledEffective;
    syncAnnFlags();
    if (emitOutput && profileWarnings.length) {
      for (const warning of profileWarnings) {
        console.warn(`[search] ${warning}`);
      }
    }
    const sqliteCodePath = sqlitePaths.codePath;
    const sqliteProsePath = sqlitePaths.prosePath;
    const sqliteExtractedProsePath = sqlitePaths.extractedProsePath;
    const lmdbCodePath = lmdbPaths.codePath;
    const lmdbProsePath = lmdbPaths.prosePath;
    const sqliteStateCode = resolvedSqliteStates.code;
    const sqliteStateProse = resolvedSqliteStates.prose;
    const sqliteStateExtractedProse = resolvedSqliteStates['extracted-prose'];
    const sqliteStateRecords = resolvedSqliteStates.records;
    const lmdbStateCode = resolvedLmdbStates.code;
    const lmdbStateProse = resolvedLmdbStates.prose;
    const sqliteCodeAvailable = sqliteAvailability.code;
    const sqliteProseAvailable = sqliteAvailability.prose;
    const sqliteExtractedProseAvailable = sqliteAvailability.extractedProse;
    const sqliteAvailable = sqliteAvailability.all;
    const lmdbCodeAvailable = lmdbAvailability.code;
    const lmdbProseAvailable = lmdbAvailability.prose;
    const lmdbAvailable = lmdbAvailability.all;

    const backendContextResolution = await resolveRunSearchBackendContext({
      selectionInput: {
        backendArg,
        sqliteAvailable,
        sqliteCodeAvailable,
        sqliteProseAvailable,
        sqliteExtractedProseAvailable,
        sqliteCodePath,
        sqliteProsePath,
        sqliteExtractedProsePath,
        lmdbAvailable,
        lmdbCodeAvailable,
        lmdbProseAvailable,
        lmdbCodePath,
        lmdbProsePath,
        needsSqlite,
        needsCode,
        needsProse,
        requiresExtractedProse,
        defaultBackend: policy?.retrieval?.backend || 'sqlite',
        sqliteRootsMixed,
        lmdbRootsMixed,
        asOfRef: asOfContext?.ref || 'latest',
        emitOutput,
        sqliteAutoChunkThreshold,
        sqliteAutoArtifactBytes,
        runCode,
        runProse,
        runExtractedProse: runExtractedProseRaw,
        resolveSearchIndexDir
      },
      contextInput: {
        needsCode,
        needsProse,
        loadExtractedProseSqlite,
        sqliteCodePath,
        sqliteProsePath,
        sqliteExtractedProsePath,
        vectorExtension,
        dbCache: sqliteCache,
        sqliteStates: {
          code: sqliteStateCode,
          prose: sqliteStateProse,
          'extracted-prose': sqliteStateExtractedProse
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
        storageTier,
        sqliteReadPragmas,
        rootDir,
        userConfig,
        stageTracker,
        vectorAnnEnabled,
        emitOutput
      }
    });
    if (backendContextResolution.error) {
      return bail(
        backendContextResolution.error.message,
        1,
        backendContextResolution.error.code
      );
    }
    let {
      backendPolicy,
      useSqliteSelection,
      useLmdbSelection,
      sqliteFtsEnabled,
      backendForcedLmdb,
      backendForcedTantivy,
      buildBackendContextInput,
      backendContext
    } = backendContextResolution;
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
    ensureRetrievalHealth({
      query,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      runRecords,
      backendLabel
    });
    if (backendForcedLmdb && !useLmdb) {
      return bail('LMDB backend requested but unavailable.', 1, ERROR_CODES.INVALID_REQUEST);
    }
    const branchGatePayload = await runBranchFilterGate({
      branchFilter,
      caseFile,
      rootDir,
      metricsDir,
      queryCacheDir,
      runCode,
      runProse,
      backendLabel,
      backendPolicyInfo,
      emitOutput,
      jsonOutput,
      recordSearchMetrics
    });
    if (branchGatePayload) {
      return branchGatePayload;
    }

    const planInput = buildQueryPlanInput({
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
    const {
      queryPlan,
      planIndexSignaturePayload
    } = await resolveRunSearchDictionaryAndPlan({
      stageTracker,
      throwIfAborted,
      rootDir,
      userConfig,
      metricsDir,
      query,
      argv,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      runRecords,
      langFilter,
      queryPlanCache,
      planInput,
      fileChargramN,
      useSqlite,
      backendLabel,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
      joinComments,
      asOfContext
    });

    const sparsePreflight = resolveRunSearchSparsePreflight({
      annEnabledEffective,
      useSqlite,
      backendLabel,
      sqliteFtsEnabled,
      runCode,
      runProse,
      runExtractedProseRaw,
      runRecords,
      selectedModes,
      requiresExtractedProse,
      loadExtractedProseSqlite,
      profilePolicyByMode,
      postingsConfig,
      allowSparseFallback,
      filtersActive: queryPlan.filtersActive === true,
      sparseBackend,
      sqliteHelpers,
      addProfileWarning,
      emitOutput
    });
    annEnabledEffective = sparsePreflight.annEnabledEffective;
    sparseFallbackForcedByPreflight = sparsePreflight.sparseFallbackForcedByPreflight;
    const sparseMissingByMode = sparsePreflight.sparseMissingByMode;
    if (sparsePreflight.error) {
      return bail(
        sparsePreflight.error.message,
        1,
        sparsePreflight.error.code
      );
    }
    if (sparseFallbackForcedByPreflight) {
      syncAnnFlags();
      const backendReinit = await reinitializeBackendAfterSparseFallback({
        stageTracker,
        buildBackendContextInput,
        backendPolicy,
        useSqliteSelection,
        useLmdbSelection,
        sqliteFtsEnabled,
        vectorAnnEnabled,
        backendForcedLmdb
      });
      if (backendReinit.error) {
        return bail(backendReinit.error.message, 1, backendReinit.error.code);
      }
      ({
        useSqlite,
        useLmdb,
        backendLabel,
        backendPolicyInfo,
        vectorAnnState,
        vectorAnnUsed,
        sqliteHelpers,
        lmdbHelpers
      } = backendReinit);
      telemetry.setBackend(backendLabel);
    }

    const annActive = resolveAnnActive({
      annEnabled: annEnabledEffective,
      queryTokens: queryPlan.queryTokens,
      vectorOnlyModes
    });
    const graphRankingEnabled = graphRankingConfig?.enabled === true;
    const requiredArtifacts = resolveRequiredArtifacts({
      queryPlan,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      graphRankingEnabled,
      annActive
    });
    queryPlan.requiredArtifacts = requiredArtifacts;

    const { loadIndexFromSqlite } = sqliteHelpers;
    const { loadIndexFromLmdb } = lmdbHelpers;

    const chunkAuthorFilterActive = Array.isArray(chunkAuthorFilter)
      ? chunkAuthorFilter.length > 0
      : Boolean(chunkAuthorFilter);
    const indexStatesForLoad = {
      code: sqliteStateCode || null,
      prose: sqliteStateProse || null,
      'extracted-prose': sqliteStateExtractedProse || null,
      records: sqliteStateRecords || null
    };
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
    } = await loadRunSearchIndexesWithTracking({
      stageTracker,
      throwIfAborted,
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
      chunkAuthorFilterActive,
      contextExpansionEnabled,
      graphRankingEnabled,
      sqliteFtsRequested: sqliteFtsEnabled,
      backendLabel,
      backendForcedTantivy,
      indexCache,
      modelIdDefault,
      fileChargramN,
      hnswConfig,
      lancedbConfig,
      tantivyConfig,
      strictIndexMetaByMode,
      indexStates: indexStatesForLoad,
      strict,
      loadIndexFromSqlite,
      loadIndexFromLmdb,
      resolvedDenseVectorMode: queryPlan.resolvedDenseVectorMode,
      joinComments,
      allowUnsafeMix,
      requiredArtifacts,
      asOfContext
    });

    const sparseFallbackAnnError = await enforceSparseFallbackAnnAvailability({
      sparseFallbackForcedByPreflight,
      sparseMissingByMode,
      idxCode,
      idxProse,
      idxExtractedProse,
      idxRecords,
      vectorAnnState,
      hnswAnnState,
      lanceAnnState
    });
    if (sparseFallbackAnnError) {
      return bail(
        sparseFallbackAnnError.message,
        1,
        sparseFallbackAnnError.code
      );
    }

    const payload = await executeSearchAndEmit({
      t0,
      emitOutput,
      jsonOutput,
      jsonCompact,
      explain,
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
      joinComments,
      extractedProseLoaded,
      topN,
      useSqlite,
      annEnabledEffective,
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
      sqliteFtsEnabled,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      sqliteFtsTrigram,
      sqliteFtsStemming,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
      bm25K1,
      bm25B,
      queryPlan,
      postingsConfig,
      symbolBoostEnabled,
      symbolBoostDefinitionWeight,
      symbolBoostExportWeight,
      relationBoostEnabled,
      relationBoostPerCall,
      relationBoostPerUse,
      relationBoostMaxBoost,
      annCandidateCap,
      annCandidateMinDocCount,
      annCandidateMaxDocCount,
      maxCandidates,
      scoreBlendEnabled,
      scoreBlendSparseWeight,
      scoreBlendAnnWeight,
      rrfEnabled,
      rrfK,
      graphRankingConfig,
      minhashMaxDocs,
      sparseBackend,
      sqliteHelpers,
      storageTier,
      sqliteTailLatencyTuning,
      sqliteFtsOverfetch,
      preferMemoryBackendOnCacheHit,
      profilePolicyByMode,
      profileWarnings,
      idxProse,
      idxExtractedProse,
      idxCode,
      idxRecords,
      modelConfig,
      modelIdForCode,
      modelIdForProse,
      modelIdForExtractedProse,
      modelIdForRecords,
      embeddingProvider,
      embeddingOnnx,
      useStubEmbeddings,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      queryCacheEnabled,
      queryCacheMaxEntries,
      queryCacheTtlMs,
      queryCacheStrategy,
      queryCachePrewarm,
      queryCachePrewarmMaxEntries,
      queryCacheMemoryFreshMs,
      backendLabel,
      backendPolicyInfo,
      indexSignaturePayload: planIndexSignaturePayload,
      showStats,
      showMatched,
      verboseCache,
      stageTracker,
      asOfContext,
      signal
    });

    recordSearchMetrics('ok');
    return payload;
  } catch (err) {
    recordSearchMetrics('error');
    emitSearchJsonError({ err, emitOutput, jsonOutput });
    throw err;
  } finally {
    await flushRunSearchResources({ telemetry, emitOutput, queryPlanCache });
  }
}


