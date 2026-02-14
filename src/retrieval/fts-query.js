const CJK_OR_EMOJI_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;
const LATIN_PATTERN = /\p{Script=Latin}/u;
const SUBSTRING_PATTERN = /[*%]/;

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeFtsLiteral = (value) => normalizeWhitespace(String(value || '').normalize('NFKC'));

export const escapeFtsLiteral = (value) => normalizeFtsLiteral(value).replace(/"/g, '""');

const quoteFtsLiteral = (value) => {
  const escaped = escapeFtsLiteral(value);
  if (!escaped) return null;
  return `"${escaped}"`;
};

const compileAstNode = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'term') {
    return quoteFtsLiteral(node.value);
  }
  if (node.type === 'phrase') {
    const phraseText = Array.isArray(node.tokens) && node.tokens.length
      ? node.tokens.join(' ')
      : node.value;
    return quoteFtsLiteral(phraseText);
  }
  if (node.type === 'not') {
    // Unary negation is enforced later by AST post-filtering, so we avoid
    // emitting raw NOT into MATCH where unary form is not portable.
    return null;
  }
  if (node.type === 'and' || node.type === 'or') {
    const left = compileAstNode(node.left);
    const right = compileAstNode(node.right);
    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;
    const op = node.type === 'and' ? 'AND' : 'OR';
    return `(${left}) ${op} (${right})`;
  }
  return null;
};

export const compileFtsMatchFromAst = (queryAst) => compileAstNode(queryAst);

const compileFtsMatchFromTokens = (tokens) => {
  if (!Array.isArray(tokens) || !tokens.length) return null;
  const literals = [];
  const seen = new Set();
  for (const token of tokens) {
    const quoted = quoteFtsLiteral(token);
    if (!quoted) continue;
    if (seen.has(quoted)) continue;
    seen.add(quoted);
    literals.push(quoted);
  }
  if (!literals.length) return null;
  return literals.join(' AND ');
};

export const resolveFtsVariant = ({
  query,
  explicitTrigram = false,
  substringMode = false,
  stemmingEnabled = false
} = {}) => {
  const rawQuery = String(query || '');
  const normalizedQuery = rawQuery.normalize('NFKC');
  const normalizedChanged = normalizedQuery !== rawQuery;
  const hasCjkOrEmoji = CJK_OR_EMOJI_PATTERN.test(normalizedQuery);
  const hasSubstringSignals = substringMode || SUBSTRING_PATTERN.test(normalizedQuery);
  const hasLatin = LATIN_PATTERN.test(normalizedQuery);

  let variant = 'unicode61';
  let tokenizer = 'unicode61 remove_diacritics 2';
  let reason = 'default_unicode61';

  if (explicitTrigram) {
    variant = 'trigram';
    tokenizer = 'trigram';
    reason = 'explicit_trigram';
  } else if (hasCjkOrEmoji || hasSubstringSignals) {
    variant = 'trigram';
    tokenizer = 'trigram';
    reason = hasCjkOrEmoji ? 'cjk_or_emoji' : 'substring_mode';
  } else if (hasLatin && stemmingEnabled) {
    variant = 'porter';
    tokenizer = 'porter';
    reason = 'stemming_override';
  }

  const reasonPath = normalizedChanged ? `${reason}+nfkc_normalized` : reason;
  return {
    variant,
    tokenizer,
    reason,
    reasonPath,
    normalizedQuery,
    normalizedChanged
  };
};

export const compileFtsMatchQuery = ({
  queryAst,
  queryTokens,
  query,
  explicitTrigram = false,
  substringMode = false,
  stemmingEnabled = false
} = {}) => {
  const variant = resolveFtsVariant({
    query,
    explicitTrigram,
    substringMode,
    stemmingEnabled
  });
  const match = compileFtsMatchFromAst(queryAst)
    || compileFtsMatchFromTokens(queryTokens);
  return {
    ...variant,
    match
  };
};
