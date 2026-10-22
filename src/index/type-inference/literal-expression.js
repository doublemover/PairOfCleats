const matching = { '[': ']', '{': '}', '(': ')' };
const closers = new Set(Object.values(matching));
const lineEnd = char => char === '\r' || char === '\n' || char === '\u2028' || char === '\u2029';

/** Quote-owned comment masking for the existing bounded literal heuristic.
 * Unsupported/unclosed lexical input supplies no literal fact. */
export const normalizeLiteralInput = (raw, languageId) => {
  const source = String(raw ?? '').trim();
  if (!source || source.length > 65536) return '';
  let value = '', quote = null, block = false, line = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (line) {
      if (lineEnd(char)) { line = false; value += char; } else value += ' ';
      continue;
    }
    if (block) {
      if (char === '*' && next === '/') { value += '  '; index++; block = false; }
      else value += lineEnd(char) ? char : ' ';
      continue;
    }
    if (quote) {
      value += char;
      if (char === '\\' && index + 1 < source.length) value += source[++index];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; value += char; continue; }
    if (languageId === 'python' ? char === '#' : char === '/' && next === '/') {
      line = true; value += ' '; continue;
    }
    if (languageId !== 'python' && char === '/' && next === '*') { block = true; value += '  '; index++; continue; }
    value += char;
  }
  if (quote || block) return '';
  return value.trim().replace(/;$/u, '').trim();
};

/** Inspect only lexical punctuation. No expression, regex, template-substitution
 * or language grammar validity is inferred from a successful scan. */
export const inspectLiteralStructure = value => {
  if (typeof value !== 'string' || value.length > 65536) return null;
  const stack = [], pairs = new Map(), commas = [], colons = [];
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (Object.hasOwn(matching, char)) {
      if (stack.length >= 128) return null;
      stack.push(index);
    } else if (closers.has(char)) {
      const open = stack.pop();
      if (open == null || matching[value[open]] !== char) return null;
      pairs.set(open, index);
    } else if (!stack.length && char === ',') commas.push(index);
    else if (!stack.length && char === ':') colons.push(index);
  }
  return quote || stack.length ? null : { pairs, commas, colons };
};

export const splitLiteralElements = value => {
  const structure = inspectLiteralStructure(value);
  if (!structure) return [];
  const parts = [];
  let start = 0;
  for (const end of [...structure.commas, value.length]) { parts.push(value.slice(start, end).trim()); start = end + 1; }
  return parts.filter(Boolean);
};

export const isWholeQuotedLiteral = (value, languageId) => {
  const quote = value[0];
  if (!['"', "'", '`'].includes(quote) || languageId === 'python' && quote === '`') return false;
  for (let index = 1; index < value.length; index++) {
    if (value[index] === '\\') { index++; continue; }
    if (value[index] === quote) return index === value.length - 1;
  }
  return false;
};
