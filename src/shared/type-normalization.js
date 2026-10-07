const normalizeWhitespace = (value) => String(value || '').replace(/\s+/gu, ' ').trim();

const stripKnownPrefixes = (text, languageId) => {
  let next = String(text || '');
  const lang = String(languageId || '').trim().toLowerCase();
  if (lang === 'python') {
    next = next.replace(/\b(?:typing|typing_extensions|builtins)\./gu, '');
  } else if (lang === 'csharp' || lang === 'cs') {
    next = next.replace(/\bglobal::/gu, '');
  } else if (lang === 'rust') {
    next = next.replace(/\b(?:std|core|alloc|crate|self|super)::/gu, '');
  } else if (lang === 'php') {
    next = next.replace(/^\??\+/u, '');
  }
  return next;
};

const normalizeDelimiterSpacing = (text) => String(text || '')
  .replace(/\s*([<>()\[\]{},|&:=])\s*/gu, '$1')
  .replace(/,(?=[^\s])/gu, ', ')
  .replace(/\|(?!\s)/gu, '| ')
  .replace(/(?<!\s)\|/gu, ' |')
  .replace(/&(?!\s)/gu, '& ')
  .replace(/(?<!\s)&/gu, ' &')
  .replace(/\s+/gu, ' ')
  .trim();

const normalizeLanguageAliases = (text, languageId) => {
  const lang = String(languageId || '').trim().toLowerCase();
  if (!text) return '';
  let next = String(text);
  if (lang === 'python') {
    next = next
      .replace(/\bboolean\b/gu, 'bool')
      .replace(/\binteger\b/gu, 'int')
      .replace(/\bstring\b/gu, 'str');
    next = next.replace(/\bOptional\[(.+)\]$/u, '$1 | None');
    next = next.replace(/\bUnion\[(.+)\]$/u, '$1');
  } else if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx' || lang === 'jsx') {
    next = next
      .replace(/\bboolean\b/gu, 'boolean')
      .replace(/\binteger\b/gu, 'number')
      .replace(/\bfloat\b/gu, 'number')
      .replace(/\bString\b/gu, 'string')
      .replace(/\bBoolean\b/gu, 'boolean')
      .replace(/\bNumber\b/gu, 'number');
  }
  return next;
};

/**
 * Canonicalize type text for deterministic comparison while preserving the
 * original source spelling for display/debug use.
 *
 * @param {unknown} value
 * @param {{languageId?:string|null}} [options]
 * @returns {{displayText:string|null,canonicalText:string|null,originalText:string|null}}
 */
export const canonicalizeTypeText = (value, options = {}) => {
  const originalText = normalizeWhitespace(value);
  if (!originalText) {
    return {
      displayText: null,
      canonicalText: null,
      originalText: null
    };
  }
  const stripped = stripKnownPrefixes(originalText, options?.languageId);
  const aliased = normalizeLanguageAliases(stripped, options?.languageId);
  const canonicalText = normalizeDelimiterSpacing(aliased);
  return {
    displayText: canonicalText || null,
    canonicalText: canonicalText.toLowerCase() || null,
    originalText
  };
};
