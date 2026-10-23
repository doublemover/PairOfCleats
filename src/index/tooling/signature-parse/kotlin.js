import { findMatchingParen, findTopLevelIndex, findTopLevelWord } from './shared.js';
import { setOwn } from '../../../shared/object-record.js';
import { normalizeTypeWhitespace } from '../../../shared/type-normalization.js';

const IDENTIFIER = /^(?:[\p{ID_Start}_][\p{ID_Continue}]*|`[^`\r\n]+`)$/u;

// After a parameter's default assignment, < and > are expression operators as
// well as possible type arguments. Parentheses/quotes still protect commas;
// unsupported unparenthesized generic-call defaults are left unresolved.
const parameterParts = value => {
  const parts = [];
  let start = 0, angle = 0, paren = 0, bracket = 0, brace = 0, quote = null, escaped = false, assigned = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (['"', "'", '`'].includes(ch)) { quote = ch; continue; }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (!assigned && ch === '<') angle += 1;
    else if (!assigned && ch === '>' && angle > 0 && value[i - 1] !== '-') angle -= 1;
    if (Math.min(paren, bracket, brace, angle) < 0) return null;
    if (paren || bracket || brace || angle) continue;
    if (ch === '=') assigned = true;
    if (ch === ',') {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
      assigned = false;
    }
  }
  if (quote || paren || bracket || brace || angle) return null;
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
};

/** Parse server-supplied Kotlin function presentation. The original signature
 * carries receiver, suspend and generic constraints; the legacy projection only
 * exposes explicit parameter/return display types. It is never compiler TypeIR,
 * inferred Unit, a resolved overload, or an exact receiver-binding assertion. */
export const parseKotlinSignature = detail => {
  if (typeof detail !== 'string' || !detail.trim() || detail.length > 65536) return null;
  const signature = detail.trim();
  const fun = findTopLevelWord(signature, 'fun');
  if (fun < 0) return null;
  let head = signature.slice(fun + 3).trim();
  if (head.startsWith('<')) {
    let depth = 0, end = -1;
    for (let i = 0; i < head.length; i += 1) {
      if (head[i] === '<') depth += 1;
      if (head[i] === '>' && head[i - 1] !== '-' && --depth === 0) { end = i; break; }
    }
    if (end < 0) return null;
    head = head.slice(end + 1).trim();
  }
  const open = head.indexOf('(');
  if (open < 0) return null;
  const nameAndReceiver = head.slice(0, open).trim();
  const name = nameAndReceiver.match(/(?:[\p{ID_Start}_][\p{ID_Continue}]*|`[^`\r\n]+`)$/u)?.[0];
  if (!name || !IDENTIFIER.test(name)) return null;
  const receiver = nameAndReceiver.slice(0, -name.length).trim();
  if (receiver && !receiver.endsWith('.')) return null;
  const close = findMatchingParen(head, open);
  if (close < 0) return null;
  let suffix = head.slice(close + 1).trim(), returnType = null;
  const where = findTopLevelWord(suffix, 'where');
  if (where >= 0) suffix = suffix.slice(0, where).trim();
  if (suffix.startsWith(':')) {
    const displayType = suffix.slice(1).trim();
    // Bodies are not signature evidence, and this adapter does not infer a
    // return type from a Kotlin expression body or a statement block.
    if (!displayType || findTopLevelIndex(displayType, '=') >= 0 || displayType.includes('{')) return null;
    returnType = normalizeTypeWhitespace(displayType);
    if (parameterParts(returnType)?.length !== 1) return null;
  } else if (suffix) return null;
  const parts = parameterParts(head.slice(open + 1, close));
  if (!parts) return null;
  const paramNames = [], paramTypes = {};
  for (const part of parts) {
    const assignment = findTopLevelIndex(part, '=', { angleBrackets: true });
    const declaration = (assignment < 0 ? part : part.slice(0, assignment)).trim();
    const colon = findTopLevelIndex(declaration, ':');
    if (colon < 0) return null;
    const paramName = declaration.slice(0, colon).replace(/^(?:(?:crossinline|noinline|vararg)\s+)+/u, '').trim();
    const type = normalizeTypeWhitespace(declaration.slice(colon + 1));
    if (!IDENTIFIER.test(paramName) || !type || paramNames.includes(paramName)) return null;
    // Verify generic/tuple commas are balanced without flattening their type.
    if (parameterParts(type)?.length !== 1) return null;
    paramNames.push(paramName);
    setOwn(paramTypes, paramName, type);
  }
  return { signature, returnType, paramNames, paramTypes };
};
