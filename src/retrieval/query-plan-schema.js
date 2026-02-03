/** Query plan schema version. */
export const QUERY_PLAN_SCHEMA_VERSION = 1;
/** Query parser version. */
export const QUERY_PARSER_VERSION = 1;
/** Query tokenizer version. */
export const QUERY_TOKENIZER_VERSION = 1;

const isPlainObject = (value) => (
  value && typeof value === 'object' && value.constructor === Object
);

const isNumberOrNull = (value) => (
  value === null || value === undefined || Number.isFinite(Number(value))
);

const isRange = (value) => (
  isPlainObject(value)
  && isNumberOrNull(value.min)
  && isNumberOrNull(value.max)
);

/**
 * Validate a query plan shape for cache usage.
 * @param {object} plan
 * @returns {boolean}
 */
export function validateQueryPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!Array.isArray(plan.queryTokens)) return false;
  if (!Array.isArray(plan.includeTokens)) return false;
  if (!Array.isArray(plan.phraseTokens)) return false;
  if (!Array.isArray(plan.phraseNgrams)) return false;
  if (plan.phraseNgramSet && !(plan.phraseNgramSet instanceof Set)) return false;
  if (!Array.isArray(plan.excludeTokens)) return false;
  if (!Array.isArray(plan.excludePhraseNgrams)) return false;
  if (plan.excludePhraseRange && !isRange(plan.excludePhraseRange)) return false;
  if (plan.phraseRange && !isRange(plan.phraseRange)) return false;
  if (plan.highlightRegex && !(plan.highlightRegex instanceof RegExp)) return false;
  if (!isPlainObject(plan.filters)) return false;
  if (typeof plan.filtersActive !== 'boolean') return false;
  if (!isPlainObject(plan.cacheFilters)) return false;
  if (plan.requiredArtifacts && !(plan.requiredArtifacts instanceof Set)) return false;
  return true;
}
