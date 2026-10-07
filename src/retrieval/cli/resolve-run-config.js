const resolveScoreModeOverride = (value) => {
  if (value == null) return null;
  const mode = String(value).trim();
  if (!mode) return null;
  if (mode === 'sparse' || mode === 'dense' || mode === 'hybrid') return mode;
  throw new Error(`Invalid score mode "${mode}". Use sparse|dense|hybrid.`);
};

export const RUN_CONFIG_KEYS = Object.freeze([
  'query',
  'searchType',
  'searchAuthor',
  'searchImport',
  'chunkAuthorFilter',
  'searchMode',
  'runCode',
  'runProse',
  'runRecords',
  'runExtractedProse',
  'commentsEnabled',
  'embeddingProvider',
  'embeddingOnnx',
  'hnswConfig',
  'sqliteAutoChunkThreshold',
  'sqliteAutoArtifactBytes',
  'postingsConfig',
  'filePrefilterEnabled',
  'searchRegexConfig',
  'fileChargramN',
  'vectorExtension',
  'annBackend',
  'bm25K1',
  'bm25B',
  'branchesMin',
  'loopsMin',
  'breaksMin',
  'continuesMin',
  'churnMin',
  'modifiedAfter',
  'modifiedSinceDays',
  'fileFilter',
  'caseFile',
  'caseTokens',
  'branchFilter',
  'extFilter',
  'langFilter',
  'extImpossible',
  'langImpossible',
  'metaFilters',
  'annEnabled',
  'annFlagPresent',
  'allowSparseFallback',
  'allowUnsafeMix',
  'scoreBlendEnabled',
  'scoreBlendSparseWeight',
  'scoreBlendAnnWeight',
  'symbolBoostEnabled',
  'symbolBoostDefinitionWeight',
  'symbolBoostExportWeight',
  'relationBoostEnabled',
  'relationBoostPerCall',
  'relationBoostPerUse',
  'relationBoostMaxBoost',
  'annCandidateCap',
  'annCandidateMinDocCount',
  'annCandidateMaxDocCount',
  'minhashMaxDocs',
  'maxCandidates',
  'storageTier',
  'queryCacheEnabled',
  'queryCacheMaxEntries',
  'queryCacheTtlMs',
  'queryCacheStrategy',
  'queryCachePrewarm',
  'queryCachePrewarmMaxEntries',
  'queryCacheMemoryFreshMs',
  'rrfEnabled',
  'rrfK',
  'graphRankingConfig',
  'contextExpansionEnabled',
  'contextExpansionOptions',
  'contextExpansionRespectFilters',
  'sqliteFtsNormalize',
  'sqliteFtsProfile',
  'sqliteFtsWeights',
  'sqliteFtsTrigram',
  'sqliteFtsStemming',
  'sqliteTailLatencyTuning',
  'sqliteFtsOverfetch',
  'preferMemoryBackendOnCacheHit',
  'sqliteReadPragmas',
  'fieldWeightsConfig',
  'explain',
  'explainTier',
  'denseVectorMode',
  'strict',
  'backendArg',
  'lancedbConfig',
  'tantivyConfig',
  'sparseBackend',
  'scoreMode'
]);

const RUN_CONFIG_NORMALIZED_KEYS = Object.freeze(
  RUN_CONFIG_KEYS.filter((key) => key !== 'scoreMode')
);

const projectRunConfigFromNormalized = (normalized) => {
  const runConfig = {};
  for (const key of RUN_CONFIG_NORMALIZED_KEYS) {
    runConfig[key] = normalized?.[key];
  }
  return runConfig;
};

/**
 * Resolve the runtime search config from normalized CLI options plus an
 * optional score-mode override.
 *
 * @param {object} input
 * @param {object} input.normalized
 * @param {string|null} input.scoreModeOverride
 * @returns {object}
 */
export const resolveRunConfig = ({ normalized, scoreModeOverride }) => {
  const runConfig = projectRunConfigFromNormalized(normalized);
  const {
    annEnabled: annEnabledRaw,
    scoreBlendEnabled: scoreBlendEnabledRaw,
    scoreBlendSparseWeight: scoreBlendSparseWeightRaw,
    scoreBlendAnnWeight: scoreBlendAnnWeightRaw,
    rrfEnabled: rrfEnabledRaw
  } = runConfig;
  const scoreMode = resolveScoreModeOverride(scoreModeOverride);
  runConfig.annEnabled = scoreMode ? scoreMode !== 'sparse' : annEnabledRaw;
  runConfig.scoreBlendEnabled = scoreMode ? scoreMode !== 'sparse' : scoreBlendEnabledRaw;
  runConfig.scoreBlendSparseWeight = scoreMode === 'dense'
    ? 0
    : scoreMode === 'hybrid'
      ? 0.5
      : scoreBlendSparseWeightRaw;
  runConfig.scoreBlendAnnWeight = scoreMode === 'dense'
    ? 1
    : scoreMode === 'hybrid'
      ? 0.5
      : scoreBlendAnnWeightRaw;
  runConfig.rrfEnabled = scoreMode ? false : rrfEnabledRaw;
  runConfig.scoreMode = scoreMode;
  return runConfig;
};
