import { findDeclarationBoundary } from './shared/declaration-boundary.js';
export function findBraceDelimitedBodyBounds(text, start, {
  charLiterals = false,
  tripleDoubleStrings = false,
  rustLifetimes = false,
  ecmaScriptLineTerminators = false
} = {}) {
  const boundary = findDeclarationBoundary(text, start, { charLiterals, tripleDoubleStrings, rustLifetimes, ecmaScriptLineTerminators });
  if (boundary.bodyStart < 0) return { bodyStart: -1, bodyEnd: -1 };
  start = boundary.bodyStart;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringQuote = '"';
  let inTripleString = false;
  let inChar = false;
  let braceDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n' || ecmaScriptLineTerminators && (ch === '\r' || ch === '\u2028' || ch === '\u2029')) inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (tripleDoubleStrings && inTripleString) {
        if (ch === '"' && text.startsWith('"""', i)) {
          inString = false;
          inTripleString = false;
          i += 2;
        }
        continue;
      }
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === stringQuote) inString = false;
      continue;
    }
    if (inChar) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '\'') inChar = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '`') {
      stringQuote = ch;
      if (tripleDoubleStrings && text.startsWith('"""', i)) {
        inString = true;
        inTripleString = true;
        i += 2;
      } else {
        inString = true;
      }
      continue;
    }
    if (charLiterals && ch === '\'' && !(rustLifetimes && /^'[A-Za-z_]\w*(?![\w'])/.test(text.slice(i)))) {
      inChar = true;
      continue;
    }
    if (ch === '{') {
      if (bodyStart === -1) bodyStart = i;
      braceDepth += 1;
      continue;
    }
    if (ch === '}' && bodyStart !== -1) {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return { bodyStart, bodyEnd: i + 1 };
      }
    }
  }
  return { bodyStart, bodyEnd: -1 };
}
