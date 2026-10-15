/** Explain observed search constraints without inventing missing or stale facts. */
export const explainEmptyResults = ({ filtersActive = false, filterEnumeration = null, backend = null } = {}) => {
  const reasons = [];
  if (filterEnumeration) {
    reasons.push({
      code: 'no-indexed-metadata-match',
      message: 'No indexed metadata matched this page. Unrecorded compiler or relation facts are not inferred.',
      next: 'Relax one metadata filter, or run pairofcleats tooling doctor to check provider availability.'
    });
  } else if (filtersActive) {
    reasons.push({
      code: 'query-with-filters',
      message: 'The query was evaluated with explicit filters; those constraints can exclude otherwise relevant results.',
      next: 'Repeat the query without filters, then restore them one at a time.'
    });
  } else {
    reasons.push({
      code: 'no-query-match',
      message: 'No indexed result matched the query in the selected modes.',
      next: 'Try a symbol or path fragment, or change --mode.'
    });
  }
  if (backend?.availabilityDriven) reasons.push({
    code: 'backend-fallback',
    message: 'The requested search backend was unavailable; a fallback was used.',
    next: 'Run pairofcleats tooling doctor to inspect backend availability.'
  });
  reasons.push({
    code: 'coverage-check',
    message: 'An empty result alone does not establish that the index is stale or the file was excluded.',
    next: 'Run pairofcleats index report to inspect indexed coverage before rebuilding.'
  });
  return reasons;
};
