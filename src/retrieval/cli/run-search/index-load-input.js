/**
 * Resolve whether chunk-author filtering should execute for the current query.
 *
 * @param {unknown} chunkAuthorFilter
 * @returns {boolean}
 */
export const resolveChunkAuthorFilterActive = (chunkAuthorFilter) => (
  Array.isArray(chunkAuthorFilter)
    ? chunkAuthorFilter.length > 0
    : Boolean(chunkAuthorFilter)
);

/**
 * Build normalized sqlite index-state envelope consumed by index loading.
 *
 * @param {{
 *   sqliteStateCode?:unknown,
 *   sqliteStateProse?:unknown,
 *   sqliteStateExtractedProse?:unknown,
 *   sqliteStateRecords?:unknown
 * }} [input]
 * @returns {{code:unknown,prose:unknown,'extracted-prose':unknown,records:unknown}}
 */
export const buildRunSearchIndexStatesForLoad = ({
  sqliteStateCode = null,
  sqliteStateProse = null,
  sqliteStateExtractedProse = null,
  sqliteStateRecords = null
} = {}) => ({
  code: sqliteStateCode || null,
  prose: sqliteStateProse || null,
  'extracted-prose': sqliteStateExtractedProse || null,
  records: sqliteStateRecords || null
});

/**
 * Build the full `loadRunSearchIndexesWithTracking` input payload.
 *
 * Keeps derived booleans/state normalization in one place so plan-runner
 * orchestration stays focused on control flow rather than payload assembly.
 *
 * @param {object} input
 * @returns {object}
 */
export const buildRunSearchIndexLoadInput = (input) => {
  const {
    chunkAuthorFilter,
    sqliteStateCode,
    sqliteStateProse,
    sqliteStateExtractedProse,
    sqliteStateRecords,
    queryPlan,
    sqliteFtsEnabled,
    ...passthrough
  } = input;

  return {
    ...passthrough,
    chunkAuthorFilterActive: resolveChunkAuthorFilterActive(chunkAuthorFilter),
    indexStates: buildRunSearchIndexStatesForLoad({
      sqliteStateCode,
      sqliteStateProse,
      sqliteStateExtractedProse,
      sqliteStateRecords
    }),
    filtersActive: queryPlan?.filtersActive,
    sqliteFtsRequested: sqliteFtsEnabled,
    resolvedDenseVectorMode: queryPlan?.resolvedDenseVectorMode
  };
};
