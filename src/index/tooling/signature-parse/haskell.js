const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const splitTopLevelArrows = (value) => {
  const text = String(value || '');
  const parts = [];
  let current = '';
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote = null;
  let escaped = false;

  const pushCurrent = () => {
    const trimmed = normalizeType(current);
    if (trimmed) parts.push(trimmed);
    current = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1] || '';
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') depthParen += 1;
    else if (ch === ')' && depthParen > 0) depthParen -= 1;
    else if (ch === '[') depthBracket += 1;
    else if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    else if (ch === '{') depthBrace += 1;
    else if (ch === '}' && depthBrace > 0) depthBrace -= 1;

    if (
      ch === '-'
      && next === '>'
      && depthParen === 0
      && depthBracket === 0
      && depthBrace === 0
    ) {
      pushCurrent();
      i += 1;
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return parts;
};

const stripLeadingContext = (value) => {
  const text = normalizeType(value);
  if (!text) return '';
  const forallMatch = /^forall\s+[^.]+\.\s*(.+)$/u.exec(text);
  const noForall = forallMatch ? normalizeType(forallMatch[1]) : text;
  const contextIdx = noForall.indexOf('=>');
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
