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
} from '../../tools/shared/dict-utils.js';
import { queryVectorAnn } from '../../tools/sqlite/vector-extension.js';
import { createError, ERROR_CODES, isErrorCode } from '../shared/error-codes.js';
import { getSearchUsage, parseSearchArgs } from './cli-args.js';
import { runFederatedSearch } from './federation/coordinator.js';
import { parseFederatedCliRequest } from './federation/args.js';
import { loadDictionary } from './cli-dictionary.js';
import { getIndexSignature, resolveIndexDir } from './cli-index.js';
import { isLmdbReady, isSqliteReady, loadIndexState } from './cli/index-state.js';
import { resolveAsOfContext, resolveSingleRootForModes } from '../index/as-of.js';
import { configureOutputCaches } from './output.js';
import { createSearchTelemetry } from './cli/telemetry.js';
import { getMissingFlagMessages, resolveIndexedFileCount } from './cli/options.js';
import { evaluateAutoSqliteThresholds, resolveIndexStats } from './cli/auto-sqlite.js';
import { hasIndexMeta, hasLmdbStore } from './cli/index-loader.js';
import { applyBranchFilter } from './cli/branch-filter.js';
import { createBackendContext } from './cli/backend-context.js';
import { color } from './cli/ansi.js';
import { resolveBackendSelection } from './cli/policy.js';
import { normalizeSearchOptions } from './cli/normalize-options.js';
import { buildQueryPlan } from './cli/query-plan.js';
import { createRunnerHelpers, inferJsonOutputFromArgs } from './cli/runner.js';
import { resolveRunConfig } from './cli/resolve-run-config.js';
import { resolveRequiredArtifacts } from './cli/required-artifacts.js';
import { loadSearchIndexes } from './cli/load-indexes.js';
import { runSearchSession } from './cli/run-search-session.js';
import { renderSearchOutput } from './cli/render.js';
import { recordSearchArtifacts } from './cli/persist.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../shared/code-dictionaries.js';
import { compileFilterPredicates } from './output/filters.js';
import { stableStringify } from '../shared/stable-json.js';
import { INDEX_PROFILE_DEFAULT, INDEX_PROFILE_VECTOR_ONLY } from '../contracts/index-profile.js';
import { RETRIEVAL_SPARSE_UNAVAILABLE_CODE, resolveSparseRequiredTables } from './sparse/requirements.js';
import { resolveSqliteFtsRoutingByMode } from './routing-policy.js';
import {
  buildQueryPlanCacheKey,
  buildQueryPlanConfigSignature,
  buildQueryPlanIndexSignature,
  createQueryPlanDiskCache,
  createQueryPlanEntry
} from './query-plan-cache.js';
import { createRetrievalStageTracker } from './pipeline/stage-checkpoints.js';

const PROFILE_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);

/**
 * Resolve profile id from index state with backward-compatible defaulting.
 * Older index states may not include `profile.id`, which should be treated as `default`.
 *
 * @param {object|null|undefined} state
 * @returns {string}
 */
const resolveProfileForState = (state) => {
  const id = state?.profile?.id;
  if (typeof id === 'string' && id.trim()) return id.trim().toLowerCase();
  return INDEX_PROFILE_DEFAULT;
};

/**
 * Resolve modes that should participate in profile/cohort policy checks.
 * `extracted-prose` is optional and should only be included when the request
 * explicitly targets extracted-prose.
 *
 * @param {{
 *   runCode: boolean,
 *   runProse: boolean,
 *   runRecords: boolean,
 *   requiresExtractedProse: boolean
 * }} input
 * @returns {string[]}
 */
export const resolveProfileCohortModes = ({
  runCode,
  runProse,
  runRecords,
  requiresExtractedProse
}) => PROFILE_MODES.filter((mode) => (
  (mode === 'code' && runCode)
  || (mode === 'prose' && runProse)
  || (mode === 'extracted-prose' && requiresExtractedProse)
  || (mode === 'records' && runRecords)
));

/**
 * Determine which sparse tables are missing for a mode.
 *
 * @param {{
 *   sqliteHelpers?: { hasTable?: (mode:string, tableName:string)=>boolean }|null,
 *   mode: string,
 *   postingsConfig?: object,
 *   requiredTables?: string[]|null
 * }} input
 * @returns {string[]}
 */
const collectMissingSparseTables = ({ sqliteHelpers, mode, postingsConfig, requiredTables = null }) => {
  if (!sqliteHelpers || typeof sqliteHelpers.hasTable !== 'function') return [];
  const required = Array.isArray(requiredTables)
    ? requiredTables
    : resolveSparseRequiredTables(postingsConfig);
  const missing = [];
  for (const tableName of required) {
    if (!sqliteHelpers.hasTable(mode, tableName)) missing.push(tableName);
  }
  return missing;
};

/**
 * Resolve missing sparse tables for preflight based on sqlite routing/fallback behavior.
 * For sqlite-fts-routed modes, sparse retrieval can still succeed via BM25 fallback when
 * FTS tables are absent, so preflight should only fail when both routes are unavailable.
 *
 * @param {{
 *   sqliteHelpers?: { hasTable?: (mode:string, tableName:string)=>boolean }|null,
 *   mode: string,
 *   postingsConfig?: object,
 *   sqliteFtsRoutingByMode?: { byMode?: Record<string, { desired?: string }> }|null,
 *   allowSparseFallback?: boolean,
 *   filtersActive?: boolean,
 *   sparseBackend?: string
 * }} input
 * @returns {string[]}
 */
const resolveSparsePreflightMissingTables = ({
  sqliteHelpers,
  mode,
  postingsConfig,
  sqliteFtsRoutingByMode,
  allowSparseFallback = false,
  filtersActive = false,
  sparseBackend = 'auto'
}) => {
  const desiredRoute = sqliteFtsRoutingByMode?.byMode?.[mode]?.desired || null;
  if (desiredRoute !== 'fts') {
    return collectMissingSparseTables({
      sqliteHelpers,
      mode,
      postingsConfig,
      requiredTables: resolveSparseRequiredTables(postingsConfig)
    });
  }

  const ftsRequiredTables = ['chunks', 'chunks_fts'];
  const bm25RequiredTables = resolveSparseRequiredTables(postingsConfig);
  const ftsMissing = collectMissingSparseTables({
    sqliteHelpers,
    mode,
    postingsConfig,
    requiredTables: ftsRequiredTables
  });
  const bm25Missing = collectMissingSparseTables({
    sqliteHelpers,
    mode,
    postingsConfig,
    requiredTables: bm25RequiredTables
  });
  const ftsAvailable = ftsMissing.length === 0;
  const bm25Available = bm25Missing.length === 0;
  const normalizedSparseBackend = typeof sparseBackend === 'string'
    ? sparseBackend.trim().toLowerCase()
    : 'auto';
  const bm25FallbackPossible = normalizedSparseBackend !== 'tantivy';

  if (!bm25FallbackPossible) {
    return ftsAvailable ? [] : ftsMissing;
  }

  if (allowSparseFallback === true && filtersActive === true) {
    // Active filters can disable sqlite-fts routing at runtime (when allowlists
    // cannot be pushed down), so BM25 availability must be preflighted here.
    return bm25Available ? [] : bm25Missing;
  }

  // Sparse mode can still route to BM25 when sqlite-fts returns no hits.
  // Require BM25 tables up front to avoid late runtime sparse-unavailable failures.
  if (bm25Available && (ftsAvailable || ftsMissing.length > 0)) return [];
  if (ftsAvailable && !bm25Available) return bm25Missing;
  return Array.from(new Set([...ftsMissing, ...bm25Missing]));
};

/**
 * Resolve modes that should participate in sparse preflight checks.
 * `extracted-prose` is optional for many runs and should only be validated when
 * it is explicitly required or already loaded.
 *
 * @param {{
 *   selectedModes: string[],
 *   requiresExtractedProse: boolean,
 *   loadExtractedProseSqlite: boolean
 * }} input
 * @returns {string[]}
 */
export const resolveSparsePreflightModes = ({
  selectedModes,
  requiresExtractedProse,
  loadExtractedProseSqlite
}) => {
  if (!Array.isArray(selectedModes)) return [];
  return selectedModes.filter((mode) => {
    if (mode === 'records') return false;
    if (mode !== 'extracted-prose') return true;
    return requiresExtractedProse === true || loadExtractedProseSqlite === true;
  });
};

/**
 * Resolve whether ANN should be considered active for the current query.
 * Most queries require at least one query token, but `vector_only` cohorts
 * must still run ANN for tokenless queries (for example exclusion-only input).
 *
 * @param {{
 *   annEnabled: boolean,
 *   queryTokens: string[],
 *   vectorOnlyModes: string[]
 * }} input
 * @returns {boolean}
 */
export const resolveAnnActive = ({
  annEnabled,
  queryTokens,
  vectorOnlyModes
}) => {
  if (annEnabled !== true) return false;
  if (Array.isArray(queryTokens) && queryTokens.length > 0) return true;
  return Array.isArray(vectorOnlyModes) && vectorOnlyModes.length > 0;
};

export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const telemetry = createSearchTelemetry();
  const recordSearchMetrics = (status) => telemetry.record(status);
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
  const workspacePath = typeof argv.workspace === 'string' ? argv.workspace.trim() : '';
  if (workspacePath) {
    try {
      const federatedRequest = parseFederatedCliRequest(rawArgs);
      const payload = await runFederatedSearch(federatedRequest, {
        signal,
        indexCache,
        sqliteCache
      });
      if (emitOutput) {
        process.stdout.write(`${stableStringify(payload)}\n`);
      }
      recordSearchMetrics('ok');
      return payload;
    } catch (err) {
      recordSearchMetrics('error');
      if (emitOutput && !err?.emitted) {
        const code = isErrorCode(err?.code) ? err.code : (err?.code || ERROR_CODES.INTERNAL);
        const message = err?.message || 'Federated search failed.';
        const payload = {
          ok: false,
          backend: 'federated',
          error: {
            code,
            message,
            details: {}
          }
        };
        process.stdout.write(`${stableStringify(payload)}\n`);
      }
      if (exitOnError) process.exit(1);
      throw err;
    }
  }
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
    if (!queryPlanCache) {
      const queryPlanCachePath = path.join(
        queryCacheDir || metricsDir,
        'queryPlanCache.json'
      );
      queryPlanCache = createQueryPlanDiskCache({ path: queryPlanCachePath });
      if (typeof queryPlanCache?.load === 'function') {
        queryPlanCache.load();
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
      sqliteFtsTrigram,
      sqliteFtsStemming,
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

    const asOfRequestedModes = [];
    if (runCode) asOfRequestedModes.push('code');
    if (runProse) asOfRequestedModes.push('prose');
    if (runRecords) asOfRequestedModes.push('records');
    if ((searchMode === 'extracted-prose' || searchMode === 'all') && !asOfRequestedModes.includes('extracted-prose')) {
      asOfRequestedModes.push('extracted-prose');
    }
    let asOfContext = null;
    try {
      asOfContext = resolveAsOfContext({
        repoRoot: rootDir,
        userConfig,
        requestedModes: asOfRequestedModes,
        asOf: argv['as-of'],
        snapshot: argv.snapshot,
        preferFrozen: true,
        allowMissingModesForLatest: true
      });
    } catch (err) {
      return bail(err?.message || 'Invalid --as-of value.', 1, err?.code || ERROR_CODES.INVALID_REQUEST);
    }
    const indexResolveOptions = asOfContext?.strict
      ? {
        indexDirByMode: asOfContext.indexDirByMode,
        indexBaseRootByMode: asOfContext.indexBaseRootByMode,
        explicitRef: true
      }
      : {};
    const resolveSearchIndexDir = (mode) => resolveIndexDir(rootDir, mode, userConfig, indexResolveOptions);
    if (asOfContext?.strict) {
      for (const mode of asOfRequestedModes) {
        let modeDir = null;
        try {
          modeDir = resolveSearchIndexDir(mode);
        } catch (err) {
          return bail(
            err?.message || `[search] ${mode} index is unavailable for --as-of ${asOfContext.ref}.`,
            1,
            err?.code || ERROR_CODES.NO_INDEX
          );
        }
        if (!hasIndexMeta(modeDir)) {
          return bail(
            `[search] ${mode} index not found at ${modeDir} for --as-of ${asOfContext.ref}.`,
            1,
            ERROR_CODES.NO_INDEX
          );
        }
      }
    }

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
    const profileWarnings = [];
    const profileWarningSet = new Set();
    const addProfileWarning = (warning) => {
      const text = typeof warning === 'string' ? warning.trim() : '';
      if (!text || profileWarningSet.has(text)) return;
      profileWarningSet.add(text);
      profileWarnings.push(text);
    };
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

    const sqliteStateCode = needsCode
      ? loadIndexState(rootDir, userConfig, 'code', {
        resolveOptions: indexResolveOptions,
        onCompatibilityWarning: addProfileWarning
      })
      : null;
    const sqliteStateProse = needsProse
      ? loadIndexState(rootDir, userConfig, 'prose', {
        resolveOptions: indexResolveOptions,
        onCompatibilityWarning: addProfileWarning
      })
      : null;
    const sqliteStateExtractedProse = needsExtractedProse
      ? loadIndexState(rootDir, userConfig, 'extracted-prose', {
        resolveOptions: indexResolveOptions,
        onCompatibilityWarning: addProfileWarning
      })
      : null;
    const sqliteStateRecords = runRecords
      ? loadIndexState(rootDir, userConfig, 'records', {
        resolveOptions: indexResolveOptions,
        onCompatibilityWarning: addProfileWarning
      })
      : null;
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
      requiresExtractedProse
    });
    const selectedModesWithState = selectedModes.filter((mode) => indexStateByMode[mode]);
    const profilePolicyByMode = {};
    for (const mode of selectedModes) {
      const profileId = resolveProfileForState(indexStateByMode[mode]);
      const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
      profilePolicyByMode[mode] = {
        profileId,
        vectorOnly,
        allowSparseFallback: allowSparseFallback === true,
        sparseUnavailableReason: vectorOnly ? 'profile_vector_only' : null
      };
    }
    const vectorOnlyModes = selectedModes.filter((mode) => profilePolicyByMode[mode]?.vectorOnly === true);
    const profileModes = selectedModesWithState
      .map((mode) => ({ mode, profileId: profilePolicyByMode[mode]?.profileId || INDEX_PROFILE_DEFAULT }))
      .filter((entry) => typeof entry.profileId === 'string' && entry.profileId);
    const uniqueProfileIds = Array.from(new Set(profileModes.map((entry) => entry.profileId)));
    if (uniqueProfileIds.length > 1) {
      const details = profileModes
        .map((entry) => `${entry.mode}:${entry.profileId}`)
        .join(', ');
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
    const sqliteCodeAvailable = !sqliteRootsMixed && fsSync.existsSync(sqliteCodePath) && isSqliteReady(sqliteStateCode);
    const sqliteProseAvailable = !sqliteRootsMixed && fsSync.existsSync(sqliteProsePath) && isSqliteReady(sqliteStateProse);
    const sqliteExtractedProseAvailable = !sqliteRootsMixed
      && fsSync.existsSync(sqliteExtractedProsePath)
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

    const createBackendContextWithTracking = async (stageName = 'startup.backend') => {
      const backendStart = stageTracker.mark();
      const context = await createBackendContext({
        backendPolicy,
        useSqlite: useSqliteSelection,
        useLmdb: useLmdbSelection,
        needsCode,
        needsProse,
        needsExtractedProse: loadExtractedProseSqlite,
        sqliteCodePath,
        sqliteProsePath,
        sqliteExtractedProsePath,
        sqliteFtsRequested: sqliteFtsEnabled,
        backendForcedSqlite,
        backendForcedLmdb,
        backendForcedTantivy,
        vectorExtension,
        vectorAnnEnabled,
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
        root: rootDir,
        userConfig
      });
      stageTracker.record(stageName, backendStart, { mode: 'all' });
      return context;
    };
    let backendContext = await createBackendContextWithTracking('startup.backend');

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
    const dictStart = stageTracker.mark();
    const { dict } = await loadDictionary(rootDir, dictConfig, {
      includeCode: includeCodeDicts,
      codeDictLanguages: Array.from(codeDictLanguages)
    });
    stageTracker.record('startup.dictionary', dictStart, { mode: 'all' });
    throwIfAborted();

    const planStart = stageTracker.mark();
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
    const planIndexSignaturePayload = planConfigSignature
      ? await getIndexSignature({
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
      })
      : null;
    const planIndexSignature = planConfigSignature
      ? buildQueryPlanIndexSignature(planIndexSignaturePayload)
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
    if (!queryPlan.filterPredicates) {
      queryPlan.filterPredicates = compileFilterPredicates(queryPlan.filters, { fileChargramN });
    }
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
    stageTracker.record('startup.query-plan', planStart, { mode: 'all' });

    if (!annEnabledEffective && useSqlite) {
      const sqliteFtsRouting = resolveSqliteFtsRoutingByMode({
        useSqlite,
        sqliteFtsRequested: sqliteFtsEnabled,
        sqliteFtsExplicit: backendLabel === 'sqlite-fts',
        runCode,
        runProse,
        runExtractedProse: runExtractedProseRaw,
        runRecords
      });
      const sparseMissingByMode = {};
      const sparsePreflightModes = resolveSparsePreflightModes({
        selectedModes,
        requiresExtractedProse,
        loadExtractedProseSqlite
      });
      for (const mode of sparsePreflightModes) {
        const policy = profilePolicyByMode[mode];
        if (policy?.vectorOnly) continue;
        const missing = resolveSparsePreflightMissingTables({
          sqliteHelpers,
          mode,
          postingsConfig,
          sqliteFtsRoutingByMode: sqliteFtsRouting,
          allowSparseFallback,
          filtersActive: queryPlan.filtersActive === true,
          sparseBackend
        });
        if (missing.length) sparseMissingByMode[mode] = missing;
      }
      if (Object.keys(sparseMissingByMode).length) {
        if (allowSparseFallback === true) {
          sparseFallbackForcedByPreflight = true;
          annEnabledEffective = true;
          const details = Object.entries(sparseMissingByMode)
            .map(([mode, missing]) => `${mode}: ${missing.join(', ')}`)
            .join('; ');
          const warning = (
            `Sparse tables missing for sparse-only request (${details}). ` +
            'Enabling ANN fallback because --allow-sparse-fallback was set.'
          );
          addProfileWarning(warning);
          if (emitOutput) {
            console.warn(`[search] ${warning}`);
          }
        } else {
          const details = Object.entries(sparseMissingByMode)
            .map(([mode, missing]) => `- ${mode}: ${missing.join(', ')}`)
            .join('\n');
          return bail(
            `[search] ${RETRIEVAL_SPARSE_UNAVAILABLE_CODE}: sparse-only retrieval requires sparse tables, but required tables are missing.\n${details}\n` +
              'Rebuild sparse artifacts or enable ANN fallback.',
            1,
            ERROR_CODES.CAPABILITY_MISSING
          );
        }
      }
    }
    if (sparseFallbackForcedByPreflight) {
      syncAnnFlags();
      backendContext = await createBackendContextWithTracking('startup.backend.reinit');
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

    const {
      loadIndexFromSqlite,
      buildCandidateSetSqlite,
      getTokenIndexForQuery,
      rankSqliteFts,
      rankVectorAnnSqlite
    } = sqliteHelpers;
    const { loadIndexFromLmdb } = lmdbHelpers;

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
      indexStates: {
        code: sqliteStateCode || null,
        prose: sqliteStateProse || null,
        'extracted-prose': sqliteStateExtractedProse || null,
        records: sqliteStateRecords || null
      },
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

    const modelIds = {
      code: modelIdForCode,
      prose: modelIdForProse,
      extractedProse: modelIdForExtractedProse,
      records: modelIdForRecords
    };

    const searchStart = stageTracker.mark();
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
      annEnabled: annEnabledEffective,
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
      sqliteFtsTrigram,
      sqliteFtsStemming,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
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
      relationBoost: {
        enabled: relationBoostEnabled,
        perCall: relationBoostPerCall,
        perUse: relationBoostPerUse,
        maxBoost: relationBoostMaxBoost
      },
      annCandidateCap,
      annCandidateMinDocCount,
      annCandidateMaxDocCount,
      maxCandidates,
      filters: queryPlan.filters,
      filtersActive: queryPlan.filtersActive,
      filterPredicates: queryPlan.filterPredicates,
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
      sqliteHasTable: sqliteHelpers?.hasTable,
      profilePolicyByMode,
      profileWarnings,
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
      asOfContext,
      indexDirByMode: asOfContext?.strict ? asOfContext.indexDirByMode : null,
      indexBaseRootByMode: asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
      explicitRef: asOfContext?.strict === true,
      signal,
      stageTracker
    });
    stageTracker.record('startup.search', searchStart, { mode: 'all' });

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
      routingPolicy: searchResult.routingPolicy || null,
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
      annEnabled: annEnabledEffective,
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
      profileInfo: searchResult.profile || null,
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
      stageTracker,
      outputBudget: userConfig?.search?.outputBudget || null,
      asOfContext
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
      cacheHit: searchResult.cache.hit,
      asOf: asOfContext
        ? {
          type: asOfContext.type || 'latest',
          identityHash: asOfContext.identityHash || null
        }
        : null
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
  } finally {
    if (typeof queryPlanCache?.persist === 'function') {
      try {
        await queryPlanCache.persist();
      } catch {}
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
