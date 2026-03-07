import {
  IMPORT_DISPOSITIONS,
  IMPORT_FAILURE_CAUSES,
  isActionableDisposition
} from './reason-codes.js';

const normalizeToken = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const matchesFailureCause = (entry, expectedFailureCause) => {
  const failureCause = normalizeToken(entry?.failureCause);
  if (failureCause === expectedFailureCause) return true;
  return false;
};

export const isActionableImportWarning = (entry) => (
  isActionableDisposition(normalizeToken(entry?.disposition))
);

export const isParserArtifactImportWarning = (
  entry
) => (
  matchesFailureCause(
    entry,
    IMPORT_FAILURE_CAUSES.PARSER_ARTIFACT
  )
);

export const isResolverGapImportWarning = (
  entry
) => (
  matchesFailureCause(
    entry,
    IMPORT_FAILURE_CAUSES.RESOLVER_GAP
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
  warnings
) => ({
  actionable: countWarningsByPredicate(warnings, isActionableImportWarning),
  parserArtifact: countWarningsByPredicate(warnings, isParserArtifactImportWarning),
  resolverGap: countWarningsByPredicate(warnings, isResolverGapImportWarning)
});

export { IMPORT_DISPOSITIONS };
