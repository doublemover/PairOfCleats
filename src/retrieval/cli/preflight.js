import { INDEX_PROFILE_DEFAULT, INDEX_PROFILE_VECTOR_ONLY } from '../../contracts/index-profile.js';
import { resolveSparseRequiredTables } from '../sparse/requirements.js';

const PROFILE_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);

/**
 * Resolve profile id from index state with backward-compatible defaulting.
 * Older index states may not include `profile.id`, which should be treated as `default`.
 *
 * @param {object|null|undefined} state
 * @returns {string}
 */
export const resolveProfileForState = (state) => {
  const id = state?.profile?.id;
  if (typeof id === 'string' && id.trim()) return id.trim().toLowerCase();
  return INDEX_PROFILE_DEFAULT;
};

/**
 * Resolve modes that should participate in profile/cohort policy checks.
 * `extracted-prose` should be included whenever that mode is searched.
 * This captures explicit extracted-prose queries and prose/default runs that
 * also execute extracted-prose retrieval.
 *
 * @param {{
 *   runCode: boolean,
 *   runProse: boolean,
 *   runRecords: boolean,
 *   runExtractedProse: boolean,
 *   requiresExtractedProse: boolean
 * }} input
 * @returns {string[]}
 */
export const resolveProfileCohortModes = ({
  runCode,
  runProse,
  runRecords,
  runExtractedProse,
  requiresExtractedProse
}) => PROFILE_MODES.filter((mode) => (
  (mode === 'code' && runCode)
  || (mode === 'prose' && runProse)
  || (mode === 'extracted-prose' && (runExtractedProse || requiresExtractedProse))
  || (mode === 'records' && runRecords)
));

/**
 * Determine which sparse tables are missing for a mode.
 *
 * @param {{
 *   sqliteHelpers?: { hasTable?: (mode:string, tableName:string)=>boolean }|null,
 *   mode: string,
 *   postingsConfig?: object,
 *   requiredTables?: string[]|null,
 *   tablePresenceCache?: Map<string, boolean>|null
 * }} input
 * @returns {string[]}
 */
const collectMissingSparseTables = ({
  sqliteHelpers,
  mode,
  postingsConfig,
  requiredTables = null,
  tablePresenceCache = null
}) => {
  if (!sqliteHelpers || typeof sqliteHelpers.hasTable !== 'function') return [];
  const required = Array.isArray(requiredTables)
    ? requiredTables
    : resolveSparseRequiredTables(postingsConfig);
  const missing = [];
  for (const tableName of required) {
    const cacheKey = `${mode}:${tableName}`;
    let present;
    if (tablePresenceCache && tablePresenceCache.has(cacheKey)) {
      present = tablePresenceCache.get(cacheKey);
    } else {
      present = sqliteHelpers.hasTable(mode, tableName);
      if (tablePresenceCache) tablePresenceCache.set(cacheKey, present);
    }
    if (!present) missing.push(tableName);
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
 *   sparseBackend?: string,
 *   tablePresenceCache?: Map<string, boolean>|null
 * }} input
 * @returns {string[]}
 */
export const resolveSparsePreflightMissingTables = ({
  sqliteHelpers,
  mode,
  postingsConfig,
  sqliteFtsRoutingByMode,
  allowSparseFallback = false,
  filtersActive = false,
  sparseBackend = 'auto',
  tablePresenceCache = null
}) => {
  const normalizedSparseBackend = typeof sparseBackend === 'string'
    ? sparseBackend.trim().toLowerCase()
    : 'auto';
  if (normalizedSparseBackend === 'tantivy') return [];

  const desiredRoute = sqliteFtsRoutingByMode?.byMode?.[mode]?.desired || null;
  if (desiredRoute !== 'fts') {
    return collectMissingSparseTables({
      sqliteHelpers,
      mode,
      postingsConfig,
      requiredTables: resolveSparseRequiredTables(postingsConfig),
      tablePresenceCache
    });
  }

  const ftsRequiredTables = ['chunks', 'chunks_fts'];
  const bm25RequiredTables = resolveSparseRequiredTables(postingsConfig);
  const ftsMissing = collectMissingSparseTables({
    sqliteHelpers,
    mode,
    postingsConfig,
    requiredTables: ftsRequiredTables,
    tablePresenceCache
  });
  const bm25Missing = collectMissingSparseTables({
    sqliteHelpers,
    mode,
    postingsConfig,
    requiredTables: bm25RequiredTables,
    tablePresenceCache
  });
  const ftsAvailable = ftsMissing.length === 0;
  const bm25Available = bm25Missing.length === 0;
  const bm25FallbackPossible = normalizedSparseBackend !== 'tantivy';

  if (!bm25FallbackPossible) {
    return ftsAvailable ? [] : ftsMissing;
  }

  if (allowSparseFallback === true && filtersActive === true) {
    return bm25Available ? [] : bm25Missing;
  }

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
 * Resolve whether lazy dense-vector loading yields real ANN artifacts.
 * The loader hook may be attached even when no dense vectors exist, so
 * fallback guards must probe and verify loaded vectors before treating
 * dense ANN as available.
 *
 * @param {object|null|undefined} idx
 * @returns {Promise<boolean>}
 */
const tryLoadDenseVectorsForAnnPath = async (idx) => {
  if (typeof idx?.loadDenseVectors !== 'function') return false;
  try {
    await idx.loadDenseVectors();
  } catch {
    return false;
  }
  return Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0;
};

const hasAnnPathForMode = async ({
  mode,
  idxByMode,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState
}) => {
  const idx = idxByMode?.[mode] || null;
  const hasMinhash = Array.isArray(idx?.minhash?.signatures) && idx.minhash.signatures.length > 0;
  if (hasMinhash) return true;
  const hasDenseVectors = Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0;
  if (hasDenseVectors) return true;
  if (vectorAnnState?.[mode]?.available) return true;
  if (hnswAnnState?.[mode]?.available) return true;
  if (lanceAnnState?.[mode]?.available) return true;
  const loadedDenseVectors = await tryLoadDenseVectorsForAnnPath(idx);
  if (loadedDenseVectors) return true;
  return false;
};

/**
 * Resolve sparse-fallback modes that still have no ANN path after index load.
 *
 * @param {{
 *   sparseMissingByMode?: Record<string, string[]>,
 *   idxByMode: Record<string, object|null|undefined>,
 *   vectorAnnState?: Record<string, {available?: boolean}>,
 *   hnswAnnState?: Record<string, {available?: boolean}>,
 *   lanceAnnState?: Record<string, {available?: boolean}>
 * }} input
 * @returns {Promise<string[]>}
 */
export const resolveSparseFallbackModesWithoutAnn = async ({
  sparseMissingByMode,
  idxByMode,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState
}) => {
  const modes = Object.keys(sparseMissingByMode || {});
  if (!modes.length) return [];
  const entries = await Promise.all(
    modes.map(async (mode) => ({
      mode,
      hasAnn: await hasAnnPathForMode({
        mode,
        idxByMode,
        vectorAnnState,
        hnswAnnState,
        lanceAnnState
      })
    }))
  );
  return entries.filter((entry) => !entry.hasAnn).map((entry) => entry.mode);
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

export { INDEX_PROFILE_DEFAULT, INDEX_PROFILE_VECTOR_ONLY };
