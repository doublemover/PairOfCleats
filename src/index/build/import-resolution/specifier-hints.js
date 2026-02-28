const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const BAZEL_LABEL_RX = /^(?:@[\w.+~/-]+)?\/\/[\w.+~/-]*(?::[\w.+~/-]+)?$/;

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
