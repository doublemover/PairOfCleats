const resolveTreeSitterLanguageFromKnownExt = (ext, { includeNative = true } = {}) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (normalizedExt === '.tsx') return 'tsx';
  if (normalizedExt === '.jsx') return 'jsx';
  if (normalizedExt === '.ts' || normalizedExt === '.cts' || normalizedExt === '.mts') return 'typescript';
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') {
    return 'javascript';
  }
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.xml') return 'xml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (!includeNative) return null;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx'
    || normalizedExt === '.hpp' || normalizedExt === '.hh' || normalizedExt === '.hxx') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return null;
};

/**
 * Resolve canonical parser language id from file extension and optional hint.
 * @param {string|null} languageId
 * @param {string|null} ext
 * @returns {string|null}
 */
export function resolveTreeSitterLanguageForExt(languageId, ext) {
  const resolvedKnown = resolveTreeSitterLanguageFromKnownExt(ext, { includeNative: false });
  if (resolvedKnown) return resolvedKnown;
  if (languageId) return languageId;
  const resolvedNative = resolveTreeSitterLanguageFromKnownExt(ext);
  if (resolvedNative) return resolvedNative;
  return null;
}

export const resolveTreeSitterNativeLanguageForExt = (languageId, ext) => (
  resolveTreeSitterLanguageFromKnownExt(ext) || languageId || null
);
