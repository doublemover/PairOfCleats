/** Protect literal contents before applying type-expression whitespace/alias rules. */
const protectTypeLiterals = input => {
  const literals = [];
  let masked = '';
  for (let index = 0; index < input.length;) {
    const quote = input[index];
    if (quote !== '"' && quote !== "'" && quote !== '\x60') { masked += input[index++]; continue; }
    const start = index++;
    let closed = false;
    while (index < input.length) {
      if (input[index] === '\\') { index += 2; continue; }
      if (input[index++] === quote) { closed = true; break; }
    }
    if (!closed) return null;
    const key = '\u0000' + literals.length + '\u0000';
    literals.push(input.slice(start, index));
    masked += key;
  }
  return { masked, restore: text => text.replace(/\u0000(\d+)\u0000/g, (_, index) => literals[Number(index)]) };
};

const normalizePythonConstructors = text => {
  const matching = { '[': ']', '(': ')', '{': '}', '<': '>' };
  const closers = new Set(Object.values(matching));
  const findEnd = (input, start) => {
    const stack = [matching[input[start]]];
    for (let index = start + 1; index < input.length; index += 1) {
      const char = input[index];
      if (matching[char]) stack.push(matching[char]);
      else if (closers.has(char) && stack.pop() !== char) return -1;
      if (!stack.length) return index;
    }
    return -1;
  };
  const splitArguments = input => {
    const parts = [];
    let start = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (matching[input[index]]) { index = findEnd(input, index); if (index < 0) return null; }
      else if (input[index] === ',') { parts.push(input.slice(start, index).trim()); start = index + 1; }
    }
    parts.push(input.slice(start).trim());
    return parts.every(Boolean) ? parts : null;
  };
  const rewrite = input => {
    let result = '';
    for (let index = 0; index < input.length;) {
      const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(input.slice(index));
      if (identifier) {
        const name = identifier[0];
        index += name.length;
        const spacing = /^\s*/.exec(input.slice(index))[0];
        const open = index + spacing.length;
        if (input[open] === '[') {
          const end = findEnd(input, open);
          if (end < 0) return null;
          const inner = rewrite(input.slice(open + 1, end));
          if (inner == null) return null;
          const args = splitArguments(inner);
          if (name === 'Optional' && args?.length === 1) result += args[0] + ' | None';
          else if (name === 'Union' && args?.length) result += args.join(' | ');
          else result += name + '[' + inner + ']';
          index = end + 1;
        } else result += name;
        continue;
      }
      if (matching[input[index]]) {
        const end = findEnd(input, index);
        if (end < 0) return null;
        const inner = rewrite(input.slice(index + 1, end));
        if (inner == null) return null;
        result += input[index] + inner + input[end]; index = end + 1; continue;
      }
      if (closers.has(input[index])) return null;
      result += input[index++];
    }
    return result;
  };
  return rewrite(text);
};

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
    next = normalizePythonConstructors(next);
  } else if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx' || lang === 'jsx') {
    next = next
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
  const originalText = String(value ?? '');
  if (!originalText.trim()) return { displayText: null, canonicalText: null, originalText: null };
  const protectedText = protectTypeLiterals(originalText);
  if (!protectedText) return { displayText: originalText, canonicalText: originalText, originalText };
  const stripped = stripKnownPrefixes(normalizeWhitespace(protectedText.masked), options?.languageId);
  const aliased = normalizeLanguageAliases(stripped, options?.languageId);
  if (aliased == null) return { displayText: originalText, canonicalText: originalText, originalText };
  const canonicalText = protectedText.restore(normalizeDelimiterSpacing(aliased));
  return { displayText: canonicalText || null, canonicalText: canonicalText || null, originalText };
};
