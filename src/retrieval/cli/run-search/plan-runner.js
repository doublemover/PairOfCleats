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
import {
  buildRunSearchBackendBootstrapInput
} from './backend-bootstrap-input.js';
import { resolveRunSearchModeProfileAvailability } from './mode-profile-availability.js';
import { loadRunSearchIndexesWithTracking } from './index-loading.js';
import { resolveRunSearchQueryBootstrap } from './query-bootstrap.js';
import { applyRunSearchSparseFallbackPolicy } from './sparse-fallback-orchestration.js';
import { enforceSparseFallbackAnnAvailability } from './sparse-fallback-guard.js';
import { buildRunSearchIndexLoadInput } from './index-load-input.js';
import { buildRunSearchExecutionInput } from './execution-input.js';
import { resolveRunSearchPlanCache } from './plan-cache-init.js';

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
    queryPlanCache = resolveRunSearchPlanCache({
      queryPlanCache,
      queryCacheDir,
      metricsDir,
      resolveRetrievalCachePath,
      createQueryPlanDiskCache
    });
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

    const modeProfileAvailability = await resolveRunSearchModeProfileAvailability({
      runCode,
      runProse,
      runExtractedProseRaw,
      runRecords,
      searchMode,
      commentsEnabled,
      rootDir,
      userConfig,
      asOfContext,
      indexResolveOptions,
      allowSparseFallback,
      allowUnsafeMix,
      annFlagPresent,
      annEnabled,
      scoreMode,
      emitOutput,
      vectorExtension,
      telemetry,
      resolveIndexAvailability: resolveRunSearchIndexAvailability
    });
    if (modeProfileAvailability.error) {
      return bail(modeProfileAvailability.error.message, 1, modeProfileAvailability.error.code);
    }
    const {
      modeNeeds,
      requiresExtractedProse,
      joinComments,
      profileWarnings,
      addProfileWarning,
      syncAnnFlags,
      profileAndAvailability
    } = modeProfileAvailability;
    let annEnabledEffective = modeProfileAvailability.annEnabledEffective;
    let vectorAnnEnabled = modeProfileAvailability.vectorAnnEnabled;
    let sparseFallbackForcedByPreflight = false;
    const {
      selectedModes,
      profilePolicyByMode,
      vectorOnlyModes,
      sqliteRootsMixed,
      lmdbRootsMixed,
      sqlitePaths,
      lmdbPaths,
      sqliteStates,
      lmdbStates,
      sqliteAvailability,
      lmdbAvailability,
      loadExtractedProseSqlite
    } = profileAndAvailability;
    const sqliteCodePath = sqlitePaths.codePath;
    const sqliteProsePath = sqlitePaths.prosePath;
    const sqliteExtractedProsePath = sqlitePaths.extractedProsePath;
    const sqliteStateCode = sqliteStates.code;
    const sqliteStateProse = sqliteStates.prose;
    const sqliteStateExtractedProse = sqliteStates['extracted-prose'];
    const sqliteStateRecords = sqliteStates.records;

    const backendBootstrapInput = buildRunSearchBackendBootstrapInput({
      modeNeeds,
      backendArg,
      defaultBackend: policy?.retrieval?.backend || 'sqlite',
      asOfContext,
      emitOutput,
      sqliteAutoChunkThreshold,
      sqliteAutoArtifactBytes,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      resolveSearchIndexDir,
      sqliteRootsMixed,
      lmdbRootsMixed,
      sqlitePaths,
      lmdbPaths,
      sqliteAvailability,
      lmdbAvailability,
      loadExtractedProseSqlite,
      vectorExtension,
      sqliteCache,
      sqliteStates,
      lmdbStates,
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
      vectorAnnEnabled
    });
    const backendContextResolution = await resolveRunSearchBackendContext(backendBootstrapInput);
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
    const queryBootstrap = await resolveRunSearchQueryBootstrap({
      branchGateInput: {
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
      },
      planInputConfig: {
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
      },
      planResolutionInput: {
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
        fileChargramN,
        useSqlite,
        backendLabel,
        sqliteCodePath,
        sqliteProsePath,
        sqliteExtractedProsePath,
        joinComments,
        asOfContext
      }
    });
    if (queryBootstrap.branchGatePayload) {
      return queryBootstrap.branchGatePayload;
    }
    const { queryPlan, planIndexSignaturePayload } = queryBootstrap;

    const sparseFallbackResolution = await applyRunSearchSparseFallbackPolicy({
      preflightInput: {
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
      },
      reinitInput: {
        stageTracker,
        buildBackendContextInput,
        backendPolicy,
        useSqliteSelection,
        useLmdbSelection,
        sqliteFtsEnabled,
        vectorAnnEnabled,
        backendForcedLmdb
      },
      syncAnnFlags
    });
    annEnabledEffective = sparseFallbackResolution.annEnabledEffective;
    sparseFallbackForcedByPreflight = sparseFallbackResolution.sparseFallbackForcedByPreflight;
    const sparseMissingByMode = sparseFallbackResolution.sparseMissingByMode;
    if (sparseFallbackResolution.error) {
      return bail(
        sparseFallbackResolution.error.message,
        1,
        sparseFallbackResolution.error.code
      );
    }
    if (sparseFallbackResolution.reinitialized) {
      ({
        useSqlite,
        useLmdb,
        backendLabel,
        backendPolicyInfo,
        vectorAnnState,
        vectorAnnUsed,
        sqliteHelpers,
        lmdbHelpers
      } = sparseFallbackResolution);
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

    const indexLoadInput = buildRunSearchIndexLoadInput({
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
      queryPlan,
      chunkAuthorFilter,
      contextExpansionEnabled,
      graphRankingEnabled,
      sqliteFtsEnabled,
      backendLabel,
      backendForcedTantivy,
      indexCache,
      modelIdDefault,
      fileChargramN,
      hnswConfig,
      lancedbConfig,
      tantivyConfig,
      strictIndexMetaByMode,
      strict,
      loadIndexFromSqlite,
      loadIndexFromLmdb,
      allowUnsafeMix,
      requiredArtifacts,
      asOfContext,
      sqliteStateCode,
      sqliteStateProse,
      sqliteStateExtractedProse,
      sqliteStateRecords,
      joinComments
    });
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
    } = await loadRunSearchIndexesWithTracking(indexLoadInput);

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

    const executionInput = buildRunSearchExecutionInput({
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
    const payload = await executeSearchAndEmit(executionInput);

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


