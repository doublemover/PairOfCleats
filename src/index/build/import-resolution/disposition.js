import {
  IMPORT_DISPOSITIONS,
  IMPORT_FAILURE_CAUSES,
  isActionableDisposition
} from './reason-codes.js';

const normalizeToken = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const matchesFailureCause = (entry, expectedFailureCause, { allowCategoryFallback = true } = {}) => {
  const failureCause = normalizeToken(entry?.failureCause);
  if (failureCause === expectedFailureCause) return true;
  if (!allowCategoryFallback) return false;
  return normalizeToken(entry?.category) === expectedFailureCause;
};

export const isActionableImportWarning = (entry) => (
  isActionableDisposition(normalizeToken(entry?.disposition))
);

export const isParserArtifactImportWarning = (
  entry,
  { allowCategoryFallback = true } = {}
) => (
  matchesFailureCause(
    entry,
    IMPORT_FAILURE_CAUSES.PARSER_ARTIFACT,
    { allowCategoryFallback }
  )
);

export const isResolverGapImportWarning = (
  entry,
  { allowCategoryFallback = true } = {}
) => (
  matchesFailureCause(
    entry,
    IMPORT_FAILURE_CAUSES.RESOLVER_GAP,
    { allowCategoryFallback }
  )
);

export const countWarningsByPredicate = (warnings, predicate) => {
  if (!Array.isArray(warnings) || typeof predicate !== 'function') return 0;
  let count = 0;
  for (const warning of warnings) {
    if (predicate(warning)) count += 1;
  }
  return count;
};

export const summarizeImportWarningDispositions = (
  warnings,
  { allowCategoryFallback = true } = {}
) => ({
  actionable: countWarningsByPredicate(warnings, isActionableImportWarning),
  parserArtifact: countWarningsByPredicate(
    warnings,
    (entry) => isParserArtifactImportWarning(entry, { allowCategoryFallback })
  ),
  resolverGap: countWarningsByPredicate(
    warnings,
    (entry) => isResolverGapImportWarning(entry, { allowCategoryFallback })
  )
});

export { IMPORT_DISPOSITIONS };
