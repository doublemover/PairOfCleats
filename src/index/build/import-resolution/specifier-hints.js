const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const BAZEL_LABEL_RX = /^(?:@[\w.+~/-]+)?\/\/[\w.+~/-]*(?::[\w.+~/-]+)?$/;
const GENERATED_SEGMENT_HINTS = Object.freeze([
  '/generated/',
  '/gen/',
  '/__generated__/'
]);
const GENERATED_TOKEN_HINTS = Object.freeze([
  '.generated.',
  '.gen.',
  '_generated',
  '.pb.',
  '.g.dart',
  '.designer.'
]);

const normalizeHint = (value) => (
  typeof value === 'string'
    ? value.trim().replace(/\\/g, '/')
    : ''
);

export const isBazelLabelSpecifier = (value) => {
  const normalized = normalizeHint(value);
  if (!normalized) return false;
  if (!(normalized.startsWith('//') || normalized.startsWith('@'))) return false;
  if (SCHEME_RELATIVE_URL_RX.test(normalized)) return false;
  return BAZEL_LABEL_RX.test(normalized);
};

export const matchGeneratedExpectationSpecifier = ({
  importer = '',
  specifier = '',
  expectedArtifactsIndex = null
} = {}) => {
  const indexMatch = expectedArtifactsIndex && typeof expectedArtifactsIndex.match === 'function'
    ? expectedArtifactsIndex.match({ importer, specifier })
    : null;
  if (indexMatch?.matched) return indexMatch;
  const normalizedImporter = normalizeHint(importer).toLowerCase();
  const normalizedSpecifier = normalizeHint(specifier).toLowerCase();
  if (!normalizedImporter && !normalizedSpecifier) {
    return {
      matched: false,
      source: 'none',
      matchType: null
    };
  }
  const importerHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedImporter.includes(hint));
  const specifierSegmentHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  const specifierTokenHit = GENERATED_TOKEN_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  if (importerHit || specifierSegmentHit || specifierTokenHit) {
    return {
      matched: true,
      source: 'heuristic',
      matchType: 'token_hint'
    };
  }
  return {
    matched: false,
    source: 'none',
    matchType: null
  };
};

export const isGeneratedExpectationSpecifier = ({
  importer = '',
  specifier = '',
  expectedArtifactsIndex = null
} = {}) => {
  const match = matchGeneratedExpectationSpecifier({
    importer,
    specifier,
    expectedArtifactsIndex
  });
  return match.matched === true;
};
