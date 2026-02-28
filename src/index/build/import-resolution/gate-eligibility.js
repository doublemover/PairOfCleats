export const DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS = Object.freeze([
  '/test/',
  '/tests/',
  '/__tests__/',
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/spec/',
  '/specs/'
]);

const normalizeExcludedImporterSegment = (segment) => {
  const normalized = String(segment || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) return '';
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const normalizeImporterForSegmentChecks = (importer) => {
  const normalized = String(importer || '').trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) return '';
  const trimmedLeading = normalized.replace(/^\/+/, '');
  const trimmed = trimmedLeading.replace(/\/+$/, '');
  return trimmed ? `/${trimmed}/` : '/';
};

export const normalizeExcludedImporterSegments = (excludedImporterSegments) => (
  Array.isArray(excludedImporterSegments)
    ? excludedImporterSegments
      .map((segment) => normalizeExcludedImporterSegment(segment))
      .filter(Boolean)
    : []
);

export const isGateEligibleImportWarning = (entry, normalizedExcludedImporterSegments) => {
  const importer = normalizeImporterForSegmentChecks(entry?.importer);
  if (!importer) return true;
  return !normalizedExcludedImporterSegments.some((segment) => importer.includes(segment));
};

export const filterGateEligibleImportWarnings = (
  warnings,
  { excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS } = {}
) => {
  const normalizedExcludedImporterSegments = normalizeExcludedImporterSegments(excludedImporterSegments);
  return Array.isArray(warnings)
    ? warnings.filter((entry) => isGateEligibleImportWarning(entry, normalizedExcludedImporterSegments))
    : [];
};

export const summarizeGateEligibleImportWarnings = (
  warnings,
  { excludedImporterSegments = DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS } = {}
) => {
  const eligibleWarnings = filterGateEligibleImportWarnings(warnings, { excludedImporterSegments });
  const unresolved = eligibleWarnings.length;
  const actionable = eligibleWarnings.filter((entry) => entry?.disposition === 'actionable').length;
  const parserArtifact = eligibleWarnings.filter((entry) => (
    entry?.failureCause === 'parser_artifact'
    || entry?.category === 'parser_artifact'
  )).length;
  const resolverGap = eligibleWarnings.filter((entry) => (
    entry?.failureCause === 'resolver_gap'
    || entry?.category === 'resolver_gap'
  )).length;
  return {
    unresolved,
    actionable,
    parserArtifact,
    resolverGap
  };
};
