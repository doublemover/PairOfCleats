/** Protect literal contents before applying type-expression whitespace/alias rules. */
const protectTypeLiterals = input => {
  // NUL is the private placeholder delimiter. Preserve unexpected input rather
  // than allowing a provider string to impersonate another literal's token.
  if (input.includes('\u0000')) return null;
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
  // Provider type text is untrusted. Bound recursive normalization and preserve
  // the original expression when structure exceeds this owner's allowance.
  if (text.length > 65536) return null;
  const pairs = new Map();
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (matching[char]) {
      if (stack.length >= 128) return null;
      stack.push(index);
    } else if (closers.has(char)) {
      const open = stack.pop();
      if (open == null || matching[text[open]] !== char) return null;
      pairs.set(open, index);
    }
  }
  if (stack.length) return null;
  const splitArguments = (start, end) => {
    const parts = [];
    let partStart = start;
    for (let index = start; index < end; index += 1) {
      if (matching[text[index]]) index = pairs.get(index);
      else if (text[index] === ',') { parts.push([partStart, index]); partStart = index + 1; }
    }
    parts.push([partStart, end]);
    return parts.every(([from, to]) => text.slice(from, to).trim()) ? parts : null;
  };
  const builtins = new Set(['bool', 'int', 'str', 'bytes', 'bytearray', 'memoryview',
    'list', 'dict', 'set', 'frozenset', 'tuple', 'object', 'type', 'complex', 'float',
    'range', 'slice']);
  const aliases = { boolean: 'bool', integer: 'int', string: 'str' };
  const identifierPattern = /[\p{ID_Start}_][\p{ID_Continue}]*(?:\s*\.\s*[\p{ID_Start}_][\p{ID_Continue}]*)*/uy;
  const rewrite = (start, end) => {
    let result = '';
    for (let index = start; index < end;) {
      identifierPattern.lastIndex = index;
      const identifier = identifierPattern.exec(text);
      if (identifier) {
        const rawName = identifier[0].replace(/\s+/gu, '');
        const parts = rawName.split('.');
        const typingOwned = parts.length === 2 && ['typing', 'typing_extensions'].includes(parts[0]);
        let name = typingOwned ? parts[1] : rawName;
        if (parts.length === 2 && parts[0] === 'builtins' && builtins.has(parts[1])) name = parts[1];
        if (parts.length === 1 && Object.hasOwn(aliases, name)) name = aliases[name];
        index = identifierPattern.lastIndex;
        let open = index;
        while (open < end && /\s/u.test(text[open])) open += 1;
        if (text[open] === '[') {
          const close = pairs.get(open);
          const args = splitArguments(open + 1, close);
          const constructorOwned = parts.length === 1 || typingOwned;
          if (constructorOwned && name === 'Union' && args?.length) {
            result += args.map(([from, to]) => rewrite(from, to).trim()).join(' | ');
          } else {
            const inner = rewrite(open + 1, close);
            if (constructorOwned && name === 'Optional' && args?.length === 1) result += inner.trim() + ' | None';
            else result += name + '[' + inner + ']';
          }
          index = close + 1;
        } else result += name;
        continue;
      }
      if (matching[text[index]]) {
        const close = pairs.get(index);
        result += text[index] + rewrite(index + 1, close) + text[close]; index = close + 1; continue;
      }
      result += text[index++];
    }
    return result;
  };
  return rewrite(0, text.length);
};

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/gu, ' ').trim();

/** Trusted syntax rewrites operate on masked text, never on literal contents.
 * Malformed quoting or private-token input is preserved without rewriting. */
export const transformTypeTextOutsideLiterals = (value, transform) => {
  const original = String(value ?? '');
  const protectedText = protectTypeLiterals(original);
  return protectedText ? protectedText.restore(transform(protectedText.masked)) : original;
};
export const normalizeTypeWhitespace = value => transformTypeTextOutsideLiterals(value, normalizeWhitespace);

const stripKnownPrefixes = (text, languageId) => {
  let next = String(text || '');
  const lang = String(languageId || '').trim().toLowerCase();
  if (lang === 'csharp' || lang === 'cs') {
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
    next = normalizePythonConstructors(next);
  } else if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx' || lang === 'jsx') {
    next = next
      .replace(/(?<![\p{ID_Continue}$\u200c\u200d.])(integer|float|String|Boolean|Number)(?![\p{ID_Continue}$\u200c\u200d]|\s*\.)/gu,
        (name, _alias, offset, input) => {
          // A separated dot still belongs to a qualified name.
          let previous = offset - 1;
          while (previous >= 0 && /\s/u.test(input[previous])) previous -= 1;
          if (input[previous] === '.') return name;
          return { integer: 'number', float: 'number', String: 'string', Boolean: 'boolean', Number: 'number' }[name];
        });
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
