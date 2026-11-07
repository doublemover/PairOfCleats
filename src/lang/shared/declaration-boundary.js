/** Bounded lexical fallback. Offsets are UTF-16, body ranges half-open.
 * A missing/bodyless/capped declaration returns bodyStart -1; consumers must
 * not interpret an unclosed parameter/type delimiter as a declaration body.
 */
export const findDeclarationBoundary = (text, start = 0, {
  stopOnSemicolon = true, charLiterals = true, tripleDoubleStrings = false,
  rustLifetimes = false, ecmaScriptLineTerminators = false, maxChars = 65536, maxLines = 256
} = {}) => {
  const limit = Math.min(text.length, start + maxChars);
  let quote = null, triple = false, blockComment = false, lineComment = false;
  let parentheses = 0, brackets = 0, angles = 0, nestedBraces = 0, lines = 0;
  let returnType = false, previous = '';
  for (let i = start; i < limit; i += 1) {
    const ch = text[i], next = text[i + 1];
    const lineEnd = ch === '\n' || ecmaScriptLineTerminators && (ch === '\r' || ch === '\u2028' || ch === '\u2029');
    if (lineEnd && !(ecmaScriptLineTerminators && ch === '\n' && text[i-1] === '\r')
      && ++lines >= maxLines) return { bodyStart: -1, signatureEnd: i, capped: true };
    if (lineComment) { if (lineEnd) lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (triple) { if (text.startsWith('"""', i)) { quote = null; triple = false; i += 2; } continue; }
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === '`' || (ch === "'" && charLiterals)) {
      const lifetime = rustLifetimes && ch === "'" && /^[A-Za-z_][A-Za-z_0-9]*(?![A-Za-z_0-9'])/.test(text.slice(i + 1));
      if (!lifetime) { quote = ch; triple = tripleDoubleStrings && text.startsWith('"""', i); if (triple) i += 2; continue; }
    }
    if (/\s/.test(ch)) continue;
    if (ch === '(') parentheses += 1;
    else if (ch === ')') parentheses = Math.max(0, parentheses - 1);
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (ch === '<' && next !== '-' && next !== '=' && !parentheses && !brackets && !nestedBraces) angles += 1;
    else if (ch === '>' && previous !== '=' && angles) angles -= 1;
    else if (ch === ':' && !parentheses && !brackets && !nestedBraces) returnType = true;
    else if (ch === '{') {
      if (parentheses || brackets || angles || nestedBraces || (returnType && [':', '|', '&', '='].includes(previous))) nestedBraces += 1;
      else return { bodyStart: i, signatureEnd: i, capped: false };
    } else if (ch === '}' && nestedBraces) nestedBraces -= 1;
    else if (ch === ';' && stopOnSemicolon && !parentheses && !brackets && !angles && !nestedBraces) {
      return { bodyStart: -1, signatureEnd: i + 1, capped: false };
    }
    previous = ch;
  }
  return { bodyStart: -1, signatureEnd: limit, capped: limit < text.length };
};
