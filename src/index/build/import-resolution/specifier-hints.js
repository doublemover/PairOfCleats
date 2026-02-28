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

export const isGeneratedExpectationSpecifier = ({ importer = '', specifier = '' } = {}) => {
  const normalizedImporter = normalizeHint(importer).toLowerCase();
  const normalizedSpecifier = normalizeHint(specifier).toLowerCase();
  if (!normalizedImporter && !normalizedSpecifier) return false;
  const importerHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedImporter.includes(hint));
  const specifierSegmentHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  const specifierTokenHit = GENERATED_TOKEN_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  return importerHit || specifierSegmentHit || specifierTokenHit;
};
