import { RETRIEVAL_SPARSE_UNAVAILABLE_CODE } from '../sparse/requirements.js';
import { bitmapHas } from '../bitmap.js';
import { FTS_UNAVAILABLE_CODE } from './constants.js';

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
  matchesQueryAst = null
}) => {
  let sparseAllowedIds = allowedIdx;
  if (typeof matchesQueryAst === 'function') {
    sparseAllowedIds = new Set();
    for (let id = 0; id < idx.chunkMeta.length; id++) {
      const chunk = idx.chunkMeta[id];
      if (chunk && (!allowedIdx || bitmapHas(allowedIdx, id)) && matchesQueryAst(idx, id, chunk, false)) {
        sparseAllowedIds.add(id);
      }
    }
  }
  const sparseFiltersEnabled = filtersEnabled || sparseAllowedIds !== allowedIdx;
  const sparseAllowedCount = sparseAllowedIds instanceof Set ? sparseAllowedIds.size : allowedCount;
  let candidates = null;
  let bmHits = [];
  let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
  let sqliteFtsUsed = false;
  const sqliteFtsDiagnostics = [];
  let sqliteFtsOverfetch = null;
  let sqliteFtsExecution = null;
  const sparseDeniedByProfile = vectorOnlyProfile === true;
  let sqliteFtsAllowed = null;
  const sqliteFtsRequiredTables = typeof sqliteFtsProvider.requireTables === 'function'
    ? sqliteFtsProvider.requireTables({ postingsConfig })
    : ['chunks_fts'];
  const sqliteFtsMissingTables = sqliteEnabledForMode
    ? checkRequiredTables(mode, sqliteFtsRequiredTables)
    : [];
  const sqliteFtsCanPushdown = !!(
    sparseFiltersEnabled
    && sparseAllowedIds
    && sparseAllowedCount > 0
  );
  const sqliteFtsEligible = sqliteEnabledForMode
    && !sparseDeniedByProfile
    && sqliteFtsDesiredForMode
    && typeof sqliteFtsCompilation.match === 'string'
    && sqliteFtsCompilation.match.trim().length > 0
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
    const tantivyResult = tantivyProvider.search({
      idx,
      queryTokens,
      mode,
      topN: expandedTopN,
      allowedIds: sparseAllowedIds
    });
    bmHits = tantivyResult.hits;
    sparseType = tantivyResult.type;
    if (bmHits.length) {
      candidates = buildCandidatesFromHits(bmHits);
    }
  } else if (sqliteFtsEligible) {
    if (sqliteFtsCanPushdown) {
      sqliteFtsAllowed = ensureAllowedSet(sparseAllowedIds);
    }
    const ftsResult = sqliteFtsProvider.search({
      idx,
      queryTokens,
      ftsMatch: sqliteFtsCompilation.match,
      mode,
      topN: expandedTopN,
      allowedIds: sqliteFtsCanPushdown ? sqliteFtsAllowed : null,
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
    bmHits = ftsResult.hits;
    sqliteFtsUsed = bmHits.length > 0;
    if (sqliteFtsUsed) {
      sparseType = ftsResult.type;
      candidates = buildCandidatesFromHits(bmHits);
    }
  }

  if (!bmHits.length && !wantsTantivy && !sparseDeniedByProfile) {
    if (sparseMissingTables.length) {
      emitSparseUnavailable(sqliteFtsDiagnostics, 'missing_required_tables', mode, {
        provider: bm25Provider.id || 'js-bm25',
        missingTables: sparseMissingTables
      });
      sparseType = 'none';
    } else {
      try {
        const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
        candidates = buildCandidateSet(idx, queryTokens, mode);
        trackReleaseSet(candidates);
        const bm25Result = bm25Provider.search({
          idx,
          queryTokens,
          mode,
          topN: expandedTopN,
          allowedIds: sparseAllowedIds,
          fieldWeights,
          k1: bm25K1,
          b: bm25B,
          tokenIndexOverride
        });
        bmHits = bm25Result.hits;
        sparseType = bm25Result.type;
        sqliteFtsUsed = false;
      } catch (error) {
        emitSparseUnavailable(sqliteFtsDiagnostics, 'provider_error', mode, {
          provider: bm25Provider.id || 'js-bm25',
          message: String(error?.message || error)
        });
        sparseType = 'none';
      }
    }
  }

  candidateMetrics.counts = {
    allowed: allowedIdx ? allowedCount : null,
    candidates: candidates ? candidates.size : null,
    bmHits: bmHits.length,
    eligibleSparse: sparseAllowedCount
  };
  const unavailableDiagnostic = sqliteFtsDiagnostics.find(
    (entry) => entry?.code === FTS_UNAVAILABLE_CODE
  );
  const sqliteRoutingReason = !sqliteEnabledForMode
    ? 'sqlite_unavailable'
    : sparseDeniedByProfile
      ? 'profile_vector_only_sparse_unavailable'
      : !sqliteFtsDesiredForMode
        ? 'mode_routed_to_sparse'
        : !sqliteFtsCompilation.match
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

  return { candidates, bmHits, sparseType, sqliteFtsUsed, sqliteFtsDiagnostics };
};
