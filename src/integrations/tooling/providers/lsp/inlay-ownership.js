/** Conservative source-backed insertion roles; unsupported headers stay observations. */
export const createInlayOwnership = ({ text, targetRange, paramNames = [], nameRange = null }) => {
  const unknown = () => null;
  if (typeof text !== 'string' || !Array.isArray(paramNames) || paramNames.length > 256) return unknown;
  const start = targetRange?.start, requestedEnd = targetRange?.end;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(requestedEnd)
    || requestedEnd < start || requestedEnd > text.length) return unknown;
  const end = Math.min(requestedEnd, start + 16384);
  if (nameRange && (!Number.isSafeInteger(nameRange.start) || !Number.isSafeInteger(nameRange.end)
    || nameRange.start < start || nameRange.end <= nameRange.start || nameRange.end > end
    || nameRange.end - nameRange.start >= 256)) return unknown;
  const anchor = nameRange ? nameRange.end : start;
  let open = -1, close = -1, quote = null, escaped = false, lineComment = false, blockComment = false;
  const commas = [], delimiters = [], closing = { '(': ')', '[': ']', '{': '}' };
  for (let index = anchor; index < end; index++) {
    const char = text[index], next = text[index + 1];
    if (lineComment) { if (/[\r\n]/u.test(char)) lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (['"', "'", '`'].includes(char)) { quote = char; continue; }
    // A slash can introduce a regex or division; angle brackets can introduce
    // generic/constraint syntax. This small owner does not guess those grammars.
    if (char === '/' || char === '<' || char === '>' || char === '#') return unknown;
    if (open < 0 && ['[', '{', ';', '='].includes(char)) return unknown;
    if (Object.hasOwn(closing, char)) {
      if (open < 0) open = index;
      delimiters.push(closing[char]);
      if (delimiters.length > 64) return unknown;
    } else if ([')', ']', '}'].includes(char)) {
      if (!delimiters.length || delimiters.pop() !== char) return unknown;
      if (!delimiters.length) { close = index; break; }
    } else if (char === ',' && delimiters.length === 1) commas.push(index);
  }
  if (open < 0 || close < 0) return unknown;
  const names = new Set(paramNames.filter(name => typeof name === 'string'));
  const boundaries = [open, ...commas, close], parameters = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const from = boundaries[index] + 1, to = boundaries[index + 1], segment = text.slice(from, to);
    // A name elsewhere in a destructuring pattern, modifier list or default
    // expression is not proof of this parameter's binding insertion point.
    const direct = segment.match(/^\s*(?:\.\.\.)?([$_\p{ID_Start}][$\u200c\u200d_\p{ID_Continue}]*)\s*(?=[:=?]|$)/u);
    if (!direct || names.size && !names.has(direct[1])) continue;
    const name = direct[1], nameOffset = direct[0].indexOf(name);
    parameters.push({ name, end: from + nameOffset + name.length, limit: to });
  }
  return offset => {
    if (!Number.isSafeInteger(offset)) return null;
    for (const parameter of parameters) if (offset >= parameter.end && offset <= parameter.limit
      && /^\s*$/u.test(text.slice(parameter.end, offset))) return { role: 'parameter', name: parameter.name };
    if (offset >= close + 1 && offset < end && /^\s*$/u.test(text.slice(close + 1, offset))) return { role: 'return' };
    return null;
  };
};
