import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getAutoPolicy,
  getRepoRoot,
  getMetricsDir,
  getQueryCacheDir,
  getModelConfig,
  loadUserConfig,
  resolveLmdbPaths,
  resolveSqlitePaths
} from '../../../../tools/shared/dict-utils.js';
import { queryVectorAnn } from '../../../../tools/sqlite/vector-extension.js';
import { createError, ERROR_CODES } from '../../../shared/error-codes.js';
import { getSearchUsage } from '../../cli-args.js';
import { isLmdbReady, isSqliteReady } from '../index-state.js';
import { resolveSingleRootForModes } from '../../../index/as-of.js';
import { configureOutputCaches } from '../../output.js';
import { getMissingFlagMessages } from '../options.js';
import { hasLmdbStore } from '../index-loader.js';
import { normalizeSearchOptions } from '../normalize-options.js';
import { createRunnerHelpers } from '../runner.js';
import { resolveRunConfig } from '../resolve-run-config.js';
import { resolveRequiredArtifacts } from '../required-artifacts.js';
import { executeSearchAndEmit } from '../search-execution.js';
import { resolveRetrievalCachePath } from '../cache-paths.js';
import { pathExists } from '../../../shared/files.js';
import {
  createQueryPlanDiskCache
} from '../../query-plan-cache.js';
import { createRetrievalStageTracker } from '../../pipeline/stage-checkpoints.js';
import {
  buildSparseFallbackAnnUnavailableMessage
} from './execution.js';
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
  loadSearchIndexStates,
  resolveStartupIndexResolution
} from './startup-index.js';
import { resolveRunSearchProfilePolicy } from './profile-policy.js';
import { resolveAutoSqliteEligibility } from './auto-thresholds.js';
import { resolveRunSearchBackendSelection } from './backend-selection.js';
import { initializeBackendContext } from './backend-context-setup.js';
import { loadRunSearchIndexesWithTracking } from './index-loading.js';
import { buildQueryPlanInput } from './plan-input.js';
import { resolveRunSearchSparsePreflight } from './sparse-preflight.js';
import { runBranchFilterGate } from './branch-gate.js';
import { resolveRunSearchDictionaryAndPlan } from './query-planning.js';
import { reinitializeBackendAfterSparseFallback } from './backend-reinit.js';

import {
  resolveAnnActive,
  resolveSparseFallbackModesWithoutAnn
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
    const dbModeSelection = [];
    if (needsCode) dbModeSelection.push('code');
    if (needsProse) dbModeSelection.push('prose');
    if (needsExtractedProse) dbModeSelection.push('extracted-prose');
    const sqliteRootSelection = resolveSingleRootForModes(
      asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
      dbModeSelection
    );
    const lmdbRootSelection = resolveSingleRootForModes(
      asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
      dbModeSelection
    );
    const sqliteRootsMixed = Boolean(asOfContext?.strict && dbModeSelection.length > 1 && sqliteRootSelection.mixed);
    const lmdbRootsMixed = Boolean(asOfContext?.strict && dbModeSelection.length > 1 && lmdbRootSelection.mixed);

    const lmdbPaths = resolveLmdbPaths(
      rootDir,
      userConfig,
      lmdbRootSelection.root ? { indexRoot: lmdbRootSelection.root } : {}
    );
    const lmdbCodePath = lmdbPaths.codePath;
    const lmdbProsePath = lmdbPaths.prosePath;
    const sqlitePaths = resolveSqlitePaths(
      rootDir,
      userConfig,
      sqliteRootSelection.root ? { indexRoot: sqliteRootSelection.root } : {}
    );
    const sqliteCodePath = sqlitePaths.codePath;
    const sqliteProsePath = sqlitePaths.prosePath;
    const sqliteExtractedProsePath = sqlitePaths.extractedProsePath;

    const loadedIndexStates = loadSearchIndexStates({
      rootDir,
      userConfig,
      runCode: needsCode,
      runProse: needsProse,
      runExtractedProse: needsExtractedProse,
      runRecords,
      indexResolveOptions,
      addProfileWarning
    });
    const sqliteStateCode = loadedIndexStates.code;
    const sqliteStateProse = loadedIndexStates.prose;
    const sqliteStateExtractedProse = loadedIndexStates.extractedProse;
    const sqliteStateRecords = loadedIndexStates.records;
    const indexStateByMode = {
      code: sqliteStateCode,
      prose: sqliteStateProse,
      'extracted-prose': sqliteStateExtractedProse,
      records: sqliteStateRecords
    };
    const profileResolution = resolveRunSearchProfilePolicy({
      runCode,
      runProse,
      runRecords,
      runExtractedProse: runExtractedProseRaw,
      requiresExtractedProse,
      indexStateByMode,
      allowSparseFallback,
      allowUnsafeMix,
      annFlagPresent,
      annEnabled: annEnabledEffective,
      scoreMode
    });
    if (profileResolution.error) {
      return bail(profileResolution.error.message, 1, profileResolution.error.code);
    }
    const {
      selectedModes,
      profilePolicyByMode,
      vectorOnlyModes
    } = profileResolution;
    annEnabledEffective = profileResolution.annEnabledEffective;
    for (const warning of profileResolution.warnings) {
      addProfileWarning(warning);
    }
    syncAnnFlags();
    if (emitOutput && profileWarnings.length) {
      for (const warning of profileWarnings) {
        console.warn(`[search] ${warning}`);
      }
    }
    const sqliteCodePathExists = !sqliteRootsMixed && await pathExists(sqliteCodePath);
    const sqliteProsePathExists = !sqliteRootsMixed && await pathExists(sqliteProsePath);
    const sqliteExtractedPathExists = !sqliteRootsMixed && await pathExists(sqliteExtractedProsePath);
    const sqliteCodeAvailable = sqliteCodePathExists && isSqliteReady(sqliteStateCode);
    const sqliteProseAvailable = sqliteProsePathExists && isSqliteReady(sqliteStateProse);
    const sqliteExtractedProseAvailable = !sqliteRootsMixed
      && sqliteExtractedPathExists
      && isSqliteReady(sqliteStateExtractedProse);
    const sqliteAvailable = (!needsCode || sqliteCodeAvailable)
      && (!needsProse || sqliteProseAvailable)
      && (!requiresExtractedProse || sqliteExtractedProseAvailable);
    const loadExtractedProseSqlite = needsExtractedProse && sqliteExtractedProseAvailable;
    const lmdbStateCode = sqliteStateCode;
    const lmdbStateProse = sqliteStateProse;
    const lmdbCodeAvailable = !lmdbRootsMixed && hasLmdbStore(lmdbCodePath) && isLmdbReady(lmdbStateCode);
    const lmdbProseAvailable = !lmdbRootsMixed && hasLmdbStore(lmdbProsePath) && isLmdbReady(lmdbStateProse);
    const lmdbAvailable = !needsExtractedProse
      && (!needsCode || lmdbCodeAvailable)
      && (!needsProse || lmdbProseAvailable);

    const {
      autoBackendRequested,
      autoSqliteAllowed,
      autoSqliteReason
    } = resolveAutoSqliteEligibility({
      backendArg,
      sqliteAvailable,
      needsSqlite,
      sqliteAutoChunkThreshold,
      sqliteAutoArtifactBytes,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      resolveSearchIndexDir
    });

    const backendSelection = await resolveRunSearchBackendSelection({
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
      autoBackendRequested,
      autoSqliteAllowed,
      autoSqliteReason,
      asOfRef: asOfContext?.ref || 'latest',
      emitOutput
    });
    if (backendSelection.error) {
      return bail(backendSelection.error.message, 1, backendSelection.error.code);
    }
    let {
      backendPolicy,
      useSqliteSelection,
      useLmdbSelection,
      sqliteFtsEnabled,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedTantivy
    } = backendSelection;

    const sqliteStates = {
      code: sqliteStateCode,
      prose: sqliteStateProse,
      'extracted-prose': sqliteStateExtractedProse
    };
    const lmdbStates = {
      code: lmdbStateCode,
      prose: lmdbStateProse
    };
    const {
      buildBackendContextInput,
      backendContext
    } = await initializeBackendContext({
      needsCode,
      needsProse,
      loadExtractedProseSqlite,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedTantivy,
      vectorExtension,
      dbCache: sqliteCache,
      sqliteStates,
      lmdbCodePath,
      lmdbProsePath,
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
      backendPolicy,
      useSqliteSelection,
      useLmdbSelection,
      sqliteFtsEnabled,
      vectorAnnEnabled,
      emitOutput
    });
    let {
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

    if (sparseFallbackForcedByPreflight) {
      const sparseFallbackModesWithoutAnn = await resolveSparseFallbackModesWithoutAnn({
        sparseMissingByMode,
        idxByMode: {
          code: idxCode,
          prose: idxProse,
          'extracted-prose': idxExtractedProse,
          records: idxRecords
        },
        vectorAnnState,
        hnswAnnState,
        lanceAnnState
      });
      if (sparseFallbackModesWithoutAnn.length) {
        return bail(
          buildSparseFallbackAnnUnavailableMessage({
            sparseMissingByMode,
            sparseFallbackModesWithoutAnn
          }),
          1,
          ERROR_CODES.CAPABILITY_MISSING
        );
      }
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


