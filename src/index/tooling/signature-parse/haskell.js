import { normalizeTypeWhitespace } from '../../../shared/type-normalization.js';

const normalizeType = (value) => normalizeTypeWhitespace(String(value ?? '').trim());
// A tick can promote a constructor/list/tuple or continue an identifier. Only
// a complete character token starts a character literal. GHC's type-level
// literals use the ordinary character/string escape spelling.
const characterLiteral = /'(?:\\(?:[0-9]+|o[0-7]+|x[0-9a-fA-F]+|\^[^\r\n]|[A-Z]+|[^\r\n])|[^'\\\r\n])'/uy;
const typeSeparators = (value, separator) => {
  const text = String(value || '');
  const positions = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    characterLiteral.lastIndex = i;
    const character = ch === '\'' && !/[\p{L}\p{N}_']/u.test(text[i - 1] || '') && characterLiteral.test(text);
    if (character || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') depthParen += 1;
    else if (ch === ')' && depthParen > 0) depthParen -= 1;
    else if (ch === '[') depthBracket += 1;
    else if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    else if (ch === '{') depthBrace += 1;
    else if (ch === '}' && depthBrace > 0) depthBrace -= 1;

    if (
      text.startsWith(separator, i)
      && depthParen === 0
      && depthBracket === 0
      && depthBrace === 0
    ) {
      positions.push(i);
      i += separator.length - 1;
      continue;
    }
  }
  return positions;
};

const splitTopLevelArrows = (value) => {
  const text = String(value || ''), parts = [];
  let start = 0;
  for (const index of typeSeparators(text, '->')) {
    parts.push(normalizeType(text.slice(start, index)));
    start = index + 2;
  }
  parts.push(normalizeType(text.slice(start)));
  return parts.filter(Boolean);
};

const stripLeadingContext = (value) => {
  const text = normalizeType(value);
  if (!text) return '';
  const forallEnd = /^forall\s/u.test(text) ? typeSeparators(text, '.')[0] : undefined;
  const noForall = forallEnd === undefined ? text : normalizeType(text.slice(forallEnd + 1));
  const contextIdx = typeSeparators(noForall, '=>')[0] ?? -1;
  if (contextIdx === -1) return noForall;
  return normalizeType(noForall.slice(contextIdx + 2));
};

/**
 * Parse Haskell type signatures from HLS detail strings.
 *
 * Supported examples:
 * 1. `greet :: Text -> Text`
 * 2. `sumTwo :: Int -> Int -> Int`
 * 3. `mkPair :: a -> b -> (a, b)`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseHaskellSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const idx = signature.indexOf('::');
  if (idx === -1) return null;
  const rhs = normalizeType(signature.slice(idx + 2));
  if (!rhs) return null;
  const chain = splitTopLevelArrows(rhs)
    .map((entry, chainIdx) => (
      chainIdx === 0 ? stripLeadingContext(entry) : normalizeType(entry)
    ))
    .filter(Boolean);
  if (!chain.length) return null;
  const returnType = chain[chain.length - 1] || null;
  const paramTypes = {};
  const paramNames = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const name = `arg${i + 1}`;
    paramNames.push(name);
    paramTypes[name] = chain[i];
  }
  if (!returnType && !paramNames.length) return null;
  return {
    signature,
    returnType,
    paramTypes,
    paramNames
  };
};
