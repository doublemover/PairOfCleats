import { RETRIEVAL_SPARSE_UNAVAILABLE_CODE } from '../sparse/requirements.js';
import { observeRetrievalProviderFailure } from './provider-failure.js';
import { FTS_UNAVAILABLE_CODE } from './constants.js';
import { requiresBooleanUniverse } from './query-ast.js';
import { createEligibilityPlan } from './eligibility-plan.js';

const emitSparseUnavailable = (diagnostics, reason, mode, extra = {}) => {
  if (!Array.isArray(diagnostics)) return;
  diagnostics.push({
    code: RETRIEVAL_SPARSE_UNAVAILABLE_CODE,
    reason,
    mode,
    ...extra
  });
};

/**
 * Execute sparse candidate and first-pass ranking stage.
 * @param {object} input
 * @returns {{candidates:Set<number>|null,bmHits:Array<object>,sparseType:string,sqliteFtsUsed:boolean,sqliteFtsDiagnostics:Array<object>}}
 */
export const runCandidateStage = ({
  idx,
  mode,
  allowedIdx,
  allowedCount,
  filtersEnabled,
  sqliteEnabledForMode,
  sqliteFtsDesiredForMode,
  sqliteFtsCompilation,
  sqliteFtsProvider,
  bm25Provider,
  tantivyProvider,
  normalizedSparseBackend,
  postingsConfig,
  sparseRequiredTables,
  sqliteHasFts,
  checkRequiredTables,
  sqliteRouteByMode,
  profileId,
  modeProfilePolicy,
  vectorOnlyProfile,
  fieldWeightsEnabled,
  queryTokens,
  expandedTopN,
  ensureAllowedSet,
  buildCandidateSet,
  candidatePool,
  trackReleaseSet,
  fieldWeights,
  bm25K1,
  bm25B,
  getTokenIndexForQuery,
  candidateMetrics,
  needLexicalCandidates = true,
  eligibilityPlan = null,
  throwIfAborted = null,
  matchesQueryAst = null,
  queryAst = null
}) => {
  let sparseAllowedIds = allowedIdx;
  const needsUniverse = requiresBooleanUniverse(queryAst);
  const nativeFtsGate = sqliteEnabledForMode && sqliteFtsDesiredForMode;
  const eligibility = eligibilityPlan || createEligibilityPlan({ idx, mode, queryAst, allowedIdx, matchesQueryAst, throwIfAborted });
  if (vectorOnlyProfile !== true && typeof matchesQueryAst === 'function' && !nativeFtsGate)
    sparseAllowedIds = eligibility.evaluate({ semantic: false });
  const sparseFiltersEnabled = filtersEnabled || sparseAllowedIds !== allowedIdx;
  let sparseAllowedCount = sparseAllowedIds instanceof Set ? sparseAllowedIds.size : allowedCount;
  let candidates = null;
  let bmHits = [];
  let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
  let sqliteFtsUsed = false;
  const sqliteFtsDiagnostics = [];
  let sqliteFtsOverfetch = null;
  let sqliteFtsExecution = null;
  let sqliteFtsMatchesQueryAst = null;
  const sparseDeniedByProfile = vectorOnlyProfile === true;
  let sqliteFtsAllowed = null;
  const sqliteFtsRequiredTables = typeof sqliteFtsProvider.requireTables === 'function'
    ? sqliteFtsProvider.requireTables({ postingsConfig, variant: sqliteFtsCompilation.variant, mode })
    : ['chunks_fts'];
  const sqliteFtsMissingTables = sqliteEnabledForMode
    ? checkRequiredTables(mode, sqliteFtsRequiredTables)
    : [];
  const sqliteFtsCanPushdown = !!(
    sparseFiltersEnabled
    && sparseAllowedIds
    && sparseAllowedCount > 0
  );
  const sqliteFtsHasQuery = (typeof sqliteFtsCompilation.match === 'string'
    && sqliteFtsCompilation.match.trim().length > 0) || needsUniverse;
  const sqliteFtsEligible = sqliteEnabledForMode
    && !sparseDeniedByProfile
    && sqliteFtsDesiredForMode
    && sqliteFtsHasQuery
    && sqliteFtsMissingTables.length === 0
    && (typeof sqliteHasFts !== 'function' || sqliteHasFts(mode))
    && (!sparseFiltersEnabled || sqliteFtsCanPushdown);
  const wantsTantivy = normalizedSparseBackend === 'tantivy';
  const sparseMissingTables = sqliteEnabledForMode
    ? checkRequiredTables(mode, sparseRequiredTables)
    : [];

  if (sqliteFtsMissingTables.length) {
    emitSparseUnavailable(sqliteFtsDiagnostics, 'missing_required_tables', mode, {
      provider: sqliteFtsProvider.id || 'sqlite-fts',
      missingTables: sqliteFtsMissingTables
    });
  }

  const buildCandidatesFromHits = (hits) => {
    if (!needLexicalCandidates) return null;
    if (!hits || !hits.length) return null;
    const set = candidatePool.acquire();
    for (const hit of hits) {
      if (Number.isFinite(hit?.idx)) set.add(hit.idx);
    }
    trackReleaseSet(set);
    return set;
  };

  if (sparseDeniedByProfile) {
    emitSparseUnavailable(sqliteFtsDiagnostics, 'profile_vector_only', mode, {
      profileId,
      guidance: 'Vector-only indexes require ANN-capable retrieval providers.'
    });
    sparseType = 'none';
  } else if (wantsTantivy) {
    try {
      if (needsUniverse && tantivyProvider.capabilities?.booleanUniverse !== 'eligible-id-completion') {
        throw Object.assign(new Error('Selected Tantivy provider does not support the admitted Boolean universe.'), {
          code: 'ERR_SPARSE_BOOLEAN_UNSUPPORTED'
        });
      }
      const work = {};
      const tantivyResult = tantivyProvider.search({ idx, queryTokens, mode, topN: expandedTopN,
        allowedIds: sparseAllowedIds, includeZeroScores: needsUniverse, work, throwIfAborted });
      candidateMetrics.tantivyExecution = work;
      bmHits = tantivyResult.hits;
      sparseType = tantivyResult.type;
      if (bmHits.length) candidates = buildCandidatesFromHits(bmHits);
    } catch (error) {
      const failure = observeRetrievalProviderFailure(error);
      throwIfAborted?.();
      if (failure.abort) throw error;
      emitSparseUnavailable(sqliteFtsDiagnostics, 'provider_error', mode, {
        provider: tantivyProvider.id || 'tantivy', failureCode: failure.code,
        message: failure.message || 'Tantivy query failed.'
      });
      failure.requireSettled();
      sparseType = 'none';
    }
  } else if (sqliteFtsEligible) {
    if (sqliteFtsCanPushdown) {
      sqliteFtsAllowed = ensureAllowedSet(sparseAllowedIds);
    }
    const ftsResult = sqliteFtsProvider.search({
      idx,
      queryTokens,
      ftsMatch: sqliteFtsCompilation.match,
      ftsVariant: sqliteFtsCompilation.variant,
      queryAst: nativeFtsGate ? queryAst : null,
      mode,
      topN: expandedTopN,
      allowedIds: sqliteFtsCanPushdown ? sqliteFtsAllowed : null,
      throwIfAborted,
      onDiagnostic: (diagnostic) => {
        if (!diagnostic || typeof diagnostic !== 'object') return;
        sqliteFtsDiagnostics.push(diagnostic);
      },
      onOverfetch: (stats) => {
        if (!stats || typeof stats !== 'object') return;
        sqliteFtsOverfetch = stats;
      }
    });
    sqliteFtsExecution = ftsResult.execution;
    sqliteFtsMatchesQueryAst = ftsResult.matchesQueryAst;
    bmHits = ftsResult.hits;
    // A completed selected FTS query owns its empty result too. Falling through
    // would replace the admitted native predicate with another scoring route.
    // Keep genuine provider failures and truncated work eligible for fallback.
    sqliteFtsUsed = bmHits.length > 0 || (!sqliteFtsDiagnostics.some(entry => entry?.code === FTS_UNAVAILABLE_CODE)
      && sqliteFtsOverfetch?.truncated !== true);
    if (sqliteFtsUsed) {
      sparseType = ftsResult.type;
      candidates = buildCandidatesFromHits(bmHits);
    }
  }

  if (!bmHits.length && !sqliteFtsUsed && !wantsTantivy && !sparseDeniedByProfile) {
    if (sparseMissingTables.length) {
      emitSparseUnavailable(sqliteFtsDiagnostics, 'missing_required_tables', mode, {
        provider: bm25Provider.id || 'js-bm25',
        missingTables: sparseMissingTables
      });
      sparseType = 'none';
    } else {
      try {
        const sqliteBm25Hydration = {};
        const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode,
          { allowedIds: sparseAllowedIds, metrics: sqliteBm25Hydration, throwIfAborted }) : null;
        if (sqliteEnabledForMode) candidateMetrics.sqliteBm25Hydration = sqliteBm25Hydration;
        if (needLexicalCandidates) {
          candidates = buildCandidateSet(idx, queryTokens, mode);
          trackReleaseSet(candidates);
        }
        if (nativeFtsGate && typeof matchesQueryAst === 'function') {
          sparseAllowedIds = eligibility.evaluate({ semantic: false, tokenIndex: tokenIndexOverride });
          sparseAllowedCount = sparseAllowedIds.size;
        }
        const bm25Work = {};
        const bm25Result = bm25Provider.search({
          idx,
          queryTokens,
          mode,
          topN: expandedTopN,
          allowedIds: sparseAllowedIds,
          fieldWeights,
          k1: bm25K1,
          b: bm25B,
          tokenIndexOverride,
          includeZeroScores: needsUniverse,
          work: bm25Work
        });
        candidateMetrics.bm25Execution = bm25Work;
        bmHits = bm25Result.hits;
        sparseType = bm25Result.type;
        sqliteFtsUsed = false;
      } catch (error) {
        const failure = observeRetrievalProviderFailure(error);
        throwIfAborted?.();
        if (failure.abort) throw error;
        emitSparseUnavailable(sqliteFtsDiagnostics, 'provider_error', mode, {
          provider: bm25Provider.id || 'js-bm25',
          message: failure.message || 'Sparse provider query failed.'
        });
        failure.requireSettled();
        sparseType = 'none';
      }
    }
  }

  candidateMetrics.counts = {
    lexicalCandidatesBuilt: needLexicalCandidates,
    allowed: allowedIdx ? allowedCount : null,
    candidates: candidates ? candidates.size : null,
    bmHits: bmHits.length,
    eligibleSparse: sparseAllowedCount
  };
  candidateMetrics.eligibility = eligibility.statistics;
  const unavailableDiagnostic = sqliteFtsDiagnostics.find(
    (entry) => entry?.code === FTS_UNAVAILABLE_CODE
  );
  const sqliteRoutingReason = !sqliteEnabledForMode
    ? 'sqlite_unavailable'
    : sparseDeniedByProfile
      ? 'profile_vector_only_sparse_unavailable'
      : !sqliteFtsDesiredForMode
        ? 'mode_routed_to_sparse'
        : !sqliteFtsHasQuery
          ? 'empty_fts_match'
          : sqliteFtsMissingTables.length > 0
            ? 'fts_missing_required_tables'
            : (typeof sqliteHasFts === 'function' && !sqliteHasFts(mode))
              ? 'fts_table_unavailable'
              : (filtersEnabled && !sqliteFtsCanPushdown)
                ? 'filters_require_pushdown'
                : (unavailableDiagnostic
                  ? FTS_UNAVAILABLE_CODE
                  : 'fts_selected');
  candidateMetrics.routing = {
    mode,
    sqliteEnabledForMode,
    sqliteFtsDesired: sqliteFtsDesiredForMode,
    reason: sqliteRoutingReason,
    profileId,
    sparseDeniedByProfile,
    route: sqliteRouteByMode || null
  };
  candidateMetrics.fts = {
    match: sqliteFtsCompilation.match,
    requestedVariant: sqliteFtsCompilation.variant,
    variant: sqliteFtsExecution?.variant || null,
    tokenizer: sqliteFtsExecution?.tokenizer || null,
    table: sqliteFtsExecution?.table || null,
    reasonPath: sqliteFtsCompilation.reasonPath,
    normalizedChanged: sqliteFtsCompilation.normalizedChanged,
    diagnostics: sqliteFtsDiagnostics,
    overfetch: sqliteFtsOverfetch
  };
  candidateMetrics.sqliteFtsUsed = sqliteFtsUsed;
  candidateMetrics.sparseType = sparseType;
  candidateMetrics.profile = {
    id: profileId,
    sparseDenied: sparseDeniedByProfile,
    sparseFallbackAllowed: modeProfilePolicy?.allowSparseFallback === true
  };

  return { candidates, bmHits, sparseType, sqliteFtsUsed, sqliteFtsDiagnostics, sqliteFtsMatchesQueryAst };
};
