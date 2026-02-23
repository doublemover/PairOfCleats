export const buildAnalysisPolicy = ({
  toolingEnabled,
  typeInferenceEnabled,
  typeInferenceCrossFileEnabled,
  riskAnalysisEnabled,
  riskAnalysisCrossFileEnabled,
  riskInterproceduralEnabled,
  riskInterproceduralSummaryOnly,
  gitBlameEnabled
}) => ({
  metadata: { enabled: true },
  risk: {
    enabled: riskAnalysisEnabled,
    crossFile: riskAnalysisCrossFileEnabled,
    interprocedural: riskInterproceduralEnabled,
    interproceduralSummaryOnly: riskInterproceduralSummaryOnly
  },
  git: {
    enabled: gitBlameEnabled,
    blame: gitBlameEnabled,
    churn: true
  },
  typeInference: {
    local: { enabled: typeInferenceEnabled },
    crossFile: { enabled: typeInferenceCrossFileEnabled },
    tooling: { enabled: typeInferenceCrossFileEnabled && toolingEnabled }
  }
});

/**
 * Build lexicon runtime config from indexing + auto-policy inputs.
 *
 * @param {object} input
 * @param {object} [input.indexingConfig]
 * @param {object|null} [input.autoPolicy]
 * @returns {object}
 */
export const buildLexiconConfig = ({ indexingConfig = {}, autoPolicy = null } = {}) => {
  const rawLexiconConfig = indexingConfig.lexicon && typeof indexingConfig.lexicon === 'object'
    ? indexingConfig.lexicon
    : {};
  const policyQualityValue = typeof autoPolicy?.quality?.value === 'string'
    ? autoPolicy.quality.value
    : null;
  const rawLexiconRelations = rawLexiconConfig.relations && typeof rawLexiconConfig.relations === 'object'
    ? rawLexiconConfig.relations
    : {};
  const rawLexiconDrop = rawLexiconRelations.drop && typeof rawLexiconRelations.drop === 'object'
    ? rawLexiconRelations.drop
    : {};
  const lexiconConfig = {
    enabled: rawLexiconConfig.enabled !== false,
    relations: {
      enabled: typeof rawLexiconRelations.enabled === 'boolean'
        ? rawLexiconRelations.enabled
        : policyQualityValue === 'max',
      stableDedupe: rawLexiconRelations.stableDedupe === true,
      drop: {
        keywords: rawLexiconDrop.keywords !== false,
        literals: rawLexiconDrop.literals !== false,
        builtins: rawLexiconDrop.builtins === true,
        types: rawLexiconDrop.types === true
      }
    }
  };
  if (rawLexiconConfig.languageOverrides && typeof rawLexiconConfig.languageOverrides === 'object') {
    lexiconConfig.languageOverrides = rawLexiconConfig.languageOverrides;
  }
  return lexiconConfig;
};
