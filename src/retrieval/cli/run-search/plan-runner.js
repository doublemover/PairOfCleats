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
import { evaluateAutoSqliteThresholds, resolveIndexStats } from '../auto-sqlite.js';
import { hasLmdbStore } from '../index-loader.js';
import { applyBranchFilter } from '../branch-filter.js';
import { resolveBackendSelection } from '../policy.js';
import { normalizeSearchOptions } from '../normalize-options.js';
import { createRunnerHelpers } from '../runner.js';
import { resolveRunConfig } from '../resolve-run-config.js';
import { resolveRequiredArtifacts } from '../required-artifacts.js';
import { loadSearchIndexes } from '../load-indexes.js';
import { executeSearchAndEmit } from '../search-execution.js';
import { resolveRetrievalCachePath } from '../cache-paths.js';
import { runWithOperationalFailurePolicy } from '../../../shared/ops-failure-injection.js';
import { pathExists } from '../../../shared/files.js';
import {
  createQueryPlanDiskCache
} from '../../query-plan-cache.js';
import { createRetrievalStageTracker } from '../../pipeline/stage-checkpoints.js';
import { resolveDictionaryAndQueryPlan } from './planning.js';
import {
  buildSparseFallbackAnnUnavailableMessage,
  createBackendContextInputFactory,
  resolveSparsePreflightFallback
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
import { createBackendContextWithTracking } from './backend-context.js';
import {
  loadSearchIndexStates,
  resolveStartupIndexResolution
} from './startup-index.js';

import {
  INDEX_PROFILE_VECTOR_ONLY,
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
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
    const selectedModes = resolveProfileCohortModes({
      runCode,
      runProse,
      runRecords,
      runExtractedProse: runExtractedProseRaw,
      requiresExtractedProse
    });
    const profilePolicyByMode = {};
    const vectorOnlyModes = [];
    const profileModeDetails = [];
    const uniqueProfileIds = new Set();
    for (const mode of selectedModes) {
      const profileId = resolveProfileForState(indexStateByMode[mode]);
      const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
      profilePolicyByMode[mode] = {
        profileId,
        vectorOnly,
        allowSparseFallback: allowSparseFallback === true,
        sparseUnavailableReason: vectorOnly ? 'profile_vector_only' : null
      };
      if (vectorOnly) vectorOnlyModes.push(mode);
      if (!indexStateByMode[mode]) continue;
      if (typeof profileId !== 'string' || !profileId) continue;
      uniqueProfileIds.add(profileId);
      profileModeDetails.push(`${mode}:${profileId}`);
    }
    if (uniqueProfileIds.size > 1) {
      const details = profileModeDetails.join(', ');
      if (allowUnsafeMix !== true) {
        return bail(
          `[search] retrieval_profile_mismatch: mixed index profiles detected (${details}). ` +
            'Rebuild indexes to a single profile or pass --allow-unsafe-mix to override.',
          1,
          ERROR_CODES.INVALID_REQUEST
        );
      }
      addProfileWarning(
        `Unsafe mixed-profile cohort override enabled (--allow-unsafe-mix): ${details}.`
      );
    }
    const sparseOnlyRequested = scoreMode === 'sparse' || (annFlagPresent && annEnabled === false);
    if (vectorOnlyModes.length && sparseOnlyRequested) {
      if (allowSparseFallback !== true) {
        const details = vectorOnlyModes.join(', ');
        return bail(
          `[search] retrieval_profile_mismatch: sparse-only retrieval cannot run against vector_only index profile (${details}). ` +
            'Re-run with ANN enabled or pass --allow-sparse-fallback to allow ANN fallback.',
          1,
          ERROR_CODES.INVALID_REQUEST
        );
      }
      addProfileWarning(
        `Sparse-only request overridden for vector_only mode(s): ${vectorOnlyModes.join(', ')}. ANN fallback was used.`
      );
      annEnabledEffective = true;
    }
    if (vectorOnlyModes.length && annEnabledEffective !== true) {
      addProfileWarning(
        `Forcing ANN on for vector_only mode(s): ${vectorOnlyModes.join(', ')}. Sparse providers are unavailable.`
      );
      annEnabledEffective = true;
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
      const collectStats = (mode) => {
        try {
          return resolveIndexStats(resolveSearchIndexDir(mode));
        } catch {
          return null;
        }
      };
      const stats = [];
      if (runCode) {
        const resolved = collectStats('code');
        if (resolved) stats.push({ mode: 'code', ...resolved });
      }
      if (runProse) {
        const resolved = collectStats('prose');
        if (resolved) stats.push({ mode: 'prose', ...resolved });
      }
      if (runExtractedProseRaw) {
        const resolved = collectStats('extracted-prose');
        if (resolved) {
          stats.push({
            mode: 'extracted-prose',
            ...resolved
          });
        }
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
      needsExtractedProse: requiresExtractedProse,
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
    if (sqliteRootsMixed) {
      if (backendForcedSqlite) {
        return bail(
          `[search] --backend sqlite cannot be used with --as-of ${asOfContext.ref}: code/prose resolve to different index roots.`,
          1,
          ERROR_CODES.INVALID_REQUEST
        );
      }
      if (emitOutput && autoBackendRequested) {
        console.warn('[search] sqlite backend disabled: explicit as-of target resolves code/prose to different roots.');
      }
      useSqliteSelection = false;
    }
    if (lmdbRootsMixed) {
      if (backendForcedLmdb) {
        return bail(
          `[search] --backend lmdb cannot be used with --as-of ${asOfContext.ref}: code/prose resolve to different index roots.`,
          1,
          ERROR_CODES.INVALID_REQUEST
        );
      }
      if (emitOutput && autoBackendRequested) {
        console.warn('[search] lmdb backend disabled: explicit as-of target resolves code/prose to different roots.');
      }
      useLmdbSelection = false;
    }
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

    const sqliteStates = {
      code: sqliteStateCode,
      prose: sqliteStateProse,
      'extracted-prose': sqliteStateExtractedProse
    };
    const lmdbStates = {
      code: lmdbStateCode,
      prose: lmdbStateProse
    };
    const buildBackendContextInput = createBackendContextInputFactory({
      needsCode,
      needsProse,
      needsExtractedProse: loadExtractedProseSqlite,
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
      root: rootDir,
      userConfig
    });
    const backendInitResult = await runWithOperationalFailurePolicy({
      target: 'retrieval.hotpath',
      operation: 'backend-context',
      execute: async () => createBackendContextWithTracking({
        stageTracker,
        contextInput: buildBackendContextInput({
          backendPolicy,
          useSqlite: useSqliteSelection,
          useLmdb: useLmdbSelection,
          sqliteFtsRequested: sqliteFtsEnabled,
          vectorAnnEnabled
        }),
        stageName: 'startup.backend'
      }),
      log: (message) => {
        if (emitOutput) console.warn(message);
      }
    });
    let backendContext = backendInitResult.value;

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

    const planInput = {
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
    };
    const {
      queryPlan,
      planIndexSignaturePayload
    } = await resolveDictionaryAndQueryPlan({
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
      indexSignatureInput: {
        useSqlite,
        backendLabel,
        sqliteCodePath,
        sqliteProsePath,
        sqliteExtractedProsePath,
        runRecords,
        runExtractedProse: runExtractedProseRaw,
        includeExtractedProse: runExtractedProseRaw || joinComments,
        root: rootDir,
        userConfig,
        indexDirByMode: asOfContext?.strict ? asOfContext.indexDirByMode : null,
        indexBaseRootByMode: asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
        explicitRef: asOfContext?.strict === true,
        asOfContext
      }
    });

    let sparseMissingByMode = {};
    const sparsePreflight = resolveSparsePreflightFallback({
      annEnabledEffective,
      useSqlite,
      backendLabel,
      sqliteFtsEnabled,
      runCode,
      runProse,
      runExtractedProse: runExtractedProseRaw,
      runRecords,
      selectedModes,
      requiresExtractedProse,
      loadExtractedProseSqlite,
      profilePolicyByMode,
      postingsConfig,
      allowSparseFallback,
      filtersActive: queryPlan.filtersActive === true,
      sparseBackend,
      sqliteHelpers
    });
    annEnabledEffective = sparsePreflight.annEnabledEffective;
    sparseFallbackForcedByPreflight = sparsePreflight.sparseFallbackForcedByPreflight;
    sparseMissingByMode = sparsePreflight.sparseMissingByMode;
    if (sparsePreflight.warning) {
      addProfileWarning(sparsePreflight.warning);
      if (emitOutput) {
        console.warn(`[search] ${sparsePreflight.warning}`);
      }
    }
    if (sparsePreflight.errorMessage) {
      return bail(
        sparsePreflight.errorMessage,
        1,
        sparsePreflight.errorCode || ERROR_CODES.CAPABILITY_MISSING
      );
    }
    if (sparseFallbackForcedByPreflight) {
      syncAnnFlags();
      backendContext = await createBackendContextWithTracking({
        stageTracker,
        contextInput: buildBackendContextInput({
          backendPolicy,
          useSqlite: useSqliteSelection,
          useLmdb: useLmdbSelection,
          sqliteFtsRequested: sqliteFtsEnabled,
          vectorAnnEnabled
        }),
        stageName: 'startup.backend.reinit'
      });
      ({
        useSqlite,
        useLmdb,
        backendLabel,
        backendPolicyInfo,
        vectorAnnState,
        vectorAnnUsed,
        sqliteHelpers,
        lmdbHelpers
      } = backendContext);
      telemetry.setBackend(backendLabel);
      if (backendForcedLmdb && !useLmdb) {
        return bail('LMDB backend requested but unavailable.', 1, ERROR_CODES.INVALID_REQUEST);
      }
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
    const indexesStart = stageTracker.mark();
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
      indexMetaByMode: strictIndexMetaByMode,
      indexStates: indexStatesForLoad,
      strict,
      loadIndexFromSqlite,
      loadIndexFromLmdb,
      resolvedDenseVectorMode: queryPlan.resolvedDenseVectorMode,
      loadExtractedProse: joinComments,
      allowUnsafeMix,
      requiredArtifacts,
      indexDirByMode: asOfContext?.strict ? asOfContext.indexDirByMode : null,
      indexBaseRootByMode: asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
      explicitRef: asOfContext?.strict === true
    });
    stageTracker.record('startup.indexes', indexesStart, { mode: 'all' });
    throwIfAborted();

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


