import { isAbsolutePathAny } from '../../src/shared/file-paths.js';

const REDACTED_ABSOLUTE_PATH = '<redacted:absolute-path>';
const REDACTED_PATH_REF = 'path:<redacted>';

const redactString = (value) => {
  if (isAbsolutePathAny(value)) return REDACTED_ABSOLUTE_PATH;
  if (value.startsWith('path:')) {
    const pathValue = value.slice('path:'.length).trim();
    if (isAbsolutePathAny(pathValue)) return REDACTED_PATH_REF;
  }
  return value;
};

export const redactAbsolutePaths = (value) => {
  if (Array.isArray(value)) return value.map((entry) => redactAbsolutePaths(entry));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactString(value) : value;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactAbsolutePaths(entry);
  }
  return output;
};

const redactDiagnosticString = value => redactString(value)
  .replace(/\b[A-Za-z]:[\\/][^\r\n'"<>]*/gu, REDACTED_ABSOLUTE_PATH)
  .replace(/\\\\[^\s\\/]+[\\/][^\r\n'"<>]*/gu, REDACTED_ABSOLUTE_PATH)
  .replace(/(?<![\w:/])\/(?:[^\s'"<>]+)(?:\/[^\s'"<>]*)?/gu, REDACTED_ABSOLUTE_PATH);

/** Diagnostic fields are projected separately from user queries and source. */
export const redactPublicDiagnostic = value => {
  if (typeof value === 'string') return redactDiagnosticString(value);
  if (Array.isArray(value)) return value.map(redactPublicDiagnostic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ['query', 'source', 'snippet', 'text', 'result'].includes(key) ? entry : redactPublicDiagnostic(entry)]));
};

/** Remove server paths from diagnostic metadata without changing source content. */
export const redactSearchResponseMetadata = (result) => ({
  ...result,
  observability: redactAbsolutePaths(result?.observability),
  retrieval: redactAbsolutePaths(result?.retrieval)
});
