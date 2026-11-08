const MAX_HEADER_CHARACTERS = 65536;
const closeFor = new Map([['(', ')'], ['[', ']'], ['{', '}']]);

/** Prefer copied grammar bounds. The lexical fallback only recognizes bounded
 * ordinary headers; ambiguous literal syntax remains explicitly unqualified. */
export const rubyCallableBodyRange = (text, chunk) => {
  const { start, end } = chunk;
  if (typeof text !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > text.length) return null;
  const meta = chunk.meta || {};
  if (meta.bodyless) return null;
  if (Number.isSafeInteger(meta.bodyStart) && Number.isSafeInteger(meta.bodyEnd)
    && meta.bodyStart >= start && meta.bodyStart <= meta.bodyEnd && meta.bodyEnd <= end) {
    return { start: meta.bodyStart, end: meta.bodyEnd };
  }
  const limit = Math.min(end, start + MAX_HEADER_CHARACTERS);
  const name = /^def[ \t]+[A-Za-z_][A-Za-z0-9_:.!?]*(?:=(?=[\s(;]))?/u.exec(text.slice(start, limit));
  if (!name) return null;
  const afterName = start + name[0].length;
  let first = afterName;
  while (first < limit && /[ \t]/u.test(text[first])) first++;
  // A leading assignment after the name is an endless method body, rather
  // than a named parameter default. Setter names consume their own '=' above.
  if (text[first] === '=' && text[first + 1] !== '=') return { start: first + 1, end };
  const stack = [];
  let quote = null, comment = false, previous = '';
  for (let cursor = afterName; cursor < limit; cursor++) {
    const char = text[cursor];
    if (comment && char !== '\n') continue;
    if (char === '\n') comment = false;
    if (quote) {
      if (char === '\\') cursor++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '#') { comment = true; continue; }
    if (['"', "'", '`'].includes(char)) { quote = char; continue; }
    // Percent/regexp/heredoc syntax needs the grammar owner; never guess a
    // boundary inside those literals and scan a declaration as executable code.
    if (char === '%' || char === '/' || char === '<' && text[cursor + 1] === '<') return null;
    if (closeFor.has(char)) stack.push(closeFor.get(char));
    else if ([')', ']', '}'].includes(char)) {
      if (stack.pop() !== char) return null;
    } else if (!stack.length && (char === ';' || char === '\n' && ![',', '\\'].includes(previous))) {
      return { start: cursor + 1, end };
    }
    if (!/\s/u.test(char)) previous = char;
  }
  return null;
};
