import {
  extractNgrams,
  extractPunctuationTokens,
  splitId,
  splitIdPreserveCase,
  splitWordsWithDict
} from '../shared/tokenize.js';

/**
 * Parse churn arg into a numeric threshold.
 * @param {string|number|boolean|undefined|null} value
 * @returns {number|null}
 */
export function parseChurnArg(value) {
  if (value === undefined || value === null) return null;
  if (value === true) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --churn value: ${value}`);
  }
  return parsed;
}

/**
 * Parse modified-after/since CLI arguments.
 * @param {string|number|undefined|null} afterArg
 * @param {string|number|undefined|null} sinceArg
 * @returns {{modifiedAfter:number|null,modifiedSinceDays:number|null}}
 */
export function parseModifiedArgs(afterArg, sinceArg) {
  let modifiedAfter = null;
  let modifiedSinceDays = null;
  if (afterArg !== undefined && afterArg !== null) {
    const parsed = Date.parse(String(afterArg));
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid --modified-after value: ${afterArg}`);
    }
    modifiedAfter = parsed;
  }
  if (sinceArg !== undefined && sinceArg !== null) {
    const parsed = Number(sinceArg);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --modified-since value: ${sinceArg}`);
    }
    modifiedSinceDays = parsed;
    const sinceMs = Date.now() - (parsed * 24 * 60 * 60 * 1000);
    modifiedAfter = modifiedAfter == null ? sinceMs : Math.max(modifiedAfter, sinceMs);
  }
  return { modifiedAfter, modifiedSinceDays };
}

const BOOLEAN_TOKEN = {
  TERM: 'term',
  PHRASE: 'phrase',
  AND: 'and',
  OR: 'or',
  NOT: 'not',
  LPAREN: 'lparen',
  RPAREN: 'rparen'
};

const BOOLEAN_OPERATORS = new Set(['and', 'or', 'not']);

const FALLBACK_STRIP_QUOTES = /^["']+|["']+$/g;
const COMPOUND_NEGATION_ERROR = 'Compound negation is not supported in boolean queries.';
const FALLBACK_HARD_ERROR_PATTERN = /Standalone "-" is not allowed|Compound negation is not supported/i;

/**
 * Tokenize boolean query string into operator/term/phrase tokens.
 *
 * @param {string} raw
 * @returns {{tokens:Array<object>,errors:string[]}}
 */
const tokenizeBooleanQuery = (raw) => {
  const tokens = [];
  const errors = [];
  const text = String(raw || '');
  let i = 0;
  const pushError = (message) => {
    errors.push(message);
  };
  const isOperatorWord = (value) => BOOLEAN_OPERATORS.has(value.toLowerCase());
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: BOOLEAN_TOKEN.LPAREN });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: BOOLEAN_TOKEN.RPAREN });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      const quote = ch;
      let j = i + 1;
      let phrase = '';
      let closed = false;
      while (j < text.length) {
        const current = text[j];
        if (current === quote) {
          closed = true;
          break;
        }
        phrase += current;
        j += 1;
      }
      if (!closed) {
        pushError('Unbalanced quote in query.');
        break;
      }
      const trimmed = phrase.trim();
      if (trimmed) {
        tokens.push({ type: BOOLEAN_TOKEN.PHRASE, value: trimmed });
      }
      i = j + 1;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: BOOLEAN_TOKEN.NOT });
      i += 1;
      continue;
    }
    if (ch === '-') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (j >= text.length) {
        pushError('Standalone "-" is not allowed in boolean queries.');
        break;
      }
      tokens.push({ type: BOOLEAN_TOKEN.NOT });
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s/.test(text[j]) && text[j] !== '(' && text[j] !== ')') {
      j += 1;
    }
    const value = text.slice(i, j);
    if (isOperatorWord(value)) {
      tokens.push({ type: value.toLowerCase() });
    } else if (value) {
      tokens.push({ type: BOOLEAN_TOKEN.TERM, value });
    }
    i = j;
  }
  return { tokens, errors };
};

/**
 * Parse boolean query tokens into expression AST with error collection.
 *
 * Supports implicit AND adjacency and explicit `AND`/`OR`/`NOT` precedence.
 *
 * @param {string} raw
 * @returns {{ast:object|null,errors:string[]}}
 */
const parseBooleanQuery = (raw) => {
  const { tokens, errors } = tokenizeBooleanQuery(raw);
  if (errors.length) return { ast: null, errors };
  let cursor = 0;
  const peek = () => tokens[cursor] || null;
  const match = (type) => {
    const next = peek();
    if (next && next.type === type) {
      cursor += 1;
      return true;
    }
    return false;
  };
  const expect = (type, message) => {
    if (match(type)) return true;
    errors.push(message);
    return false;
  };
  const isImplicitAnd = () => {
    const next = peek();
    if (!next) return false;
    return next.type === BOOLEAN_TOKEN.TERM
      || next.type === BOOLEAN_TOKEN.PHRASE
      || next.type === BOOLEAN_TOKEN.LPAREN
      || next.type === BOOLEAN_TOKEN.NOT;
  };
  const parsePrimary = () => {
    const next = peek();
    if (!next) {
      errors.push('Expected term, phrase, or "(" but found end of query.');
      return null;
    }
    if (match(BOOLEAN_TOKEN.LPAREN)) {
      const expr = parseExpression();
      if (!expect(BOOLEAN_TOKEN.RPAREN, 'Missing closing ")" in query.')) return expr;
      return expr;
    }
    if (next.type === BOOLEAN_TOKEN.TERM || next.type === BOOLEAN_TOKEN.PHRASE) {
      cursor += 1;
      return { type: next.type, value: next.value };
    }
    errors.push(`Unexpected token "${next.type}" in query.`);
    return null;
  };
  const parseUnary = () => {
    if (match(BOOLEAN_TOKEN.NOT)) {
      const child = parseUnary();
      if (!child) return null;
      return { type: BOOLEAN_TOKEN.NOT, child };
    }
    return parsePrimary();
  };
  const parseAnd = () => {
    let node = parseUnary();
    while (node && (match(BOOLEAN_TOKEN.AND) || isImplicitAnd())) {
      const right = parseUnary();
      if (!right) return node;
      node = { type: BOOLEAN_TOKEN.AND, left: node, right };
    }
    return node;
  };
  const parseOr = () => {
    let node = parseAnd();
    while (node && match(BOOLEAN_TOKEN.OR)) {
      const right = parseAnd();
      if (!right) return node;
      node = { type: BOOLEAN_TOKEN.OR, left: node, right };
    }
    return node;
  };
  const parseExpression = () => parseOr();
  const ast = parseExpression();
  if (errors.length) return { ast, errors };
  if (cursor < tokens.length) {
    const remaining = tokens.slice(cursor).map((entry) => entry.value || entry.type).join(' ');
    errors.push(`Unexpected trailing query tokens: ${remaining}`);
  }
  return { ast, errors };
};

/**
 * Flatten boolean AST into include/exclude term + phrase buckets.
 *
 * @param {object|null} ast
 * @param {{includeTerms:string[],excludeTerms:string[],phrases:string[],excludePhrases:string[]}|null} [state]
 * @param {boolean} [negated=false]
 * @param {boolean} [inCompoundNegation=false]
 * @returns {{includeTerms:string[],excludeTerms:string[],phrases:string[],excludePhrases:string[]}}
 */
const flattenQueryAst = (ast, state = null, negated = false, inCompoundNegation = false) => {
  const acc = state || {
    includeTerms: [],
    excludeTerms: [],
    phrases: [],
    excludePhrases: []
  };
  if (!ast) return acc;
  switch (ast.type) {
    case BOOLEAN_TOKEN.TERM:
      if (negated && inCompoundNegation) {
        throw new Error(COMPOUND_NEGATION_ERROR);
      }
      (negated ? acc.excludeTerms : acc.includeTerms).push(ast.value);
      return acc;
    case BOOLEAN_TOKEN.PHRASE:
      if (negated && inCompoundNegation) {
        throw new Error(COMPOUND_NEGATION_ERROR);
      }
      (negated ? acc.excludePhrases : acc.phrases).push(ast.value);
      return acc;
    case BOOLEAN_TOKEN.NOT:
      return flattenQueryAst(
        ast.child,
        acc,
        !negated,
        inCompoundNegation || ast.child?.type === BOOLEAN_TOKEN.AND || ast.child?.type === BOOLEAN_TOKEN.OR
      );
    case BOOLEAN_TOKEN.AND:
    case BOOLEAN_TOKEN.OR:
      flattenQueryAst(ast.left, acc, negated, inCompoundNegation);
      return flattenQueryAst(ast.right, acc, negated, inCompoundNegation);
    default:
      return acc;
  }
};

export function annotateQueryAst(ast, dict, options, postingsConfig) {
  if (!ast) return null;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.type === BOOLEAN_TOKEN.TERM) {
      node.tokens = tokenizeQueryTerms([node.value], dict, options);
      return node;
    }
    if (node.type === BOOLEAN_TOKEN.PHRASE) {
      const tokens = tokenizePhrase(node.value, dict, options);
      node.tokens = tokens;
      const phraseInfo = buildPhraseNgrams([tokens], postingsConfig);
      node.ngrams = phraseInfo.ngrams;
      node.ngramSet = phraseInfo.ngrams.length ? new Set(phraseInfo.ngrams) : null;
      return node;
    }
    if (node.type === BOOLEAN_TOKEN.NOT) {
      node.child = visit(node.child);
      return node;
    }
    if (node.type === BOOLEAN_TOKEN.AND || node.type === BOOLEAN_TOKEN.OR) {
      node.left = visit(node.left);
      node.right = visit(node.right);
      return node;
    }
    return node;
  };
  return visit({ ...ast });
}

/**
 * Parse a query string into include/exclude tokens and phrases.
 * @param {string} raw
 * @returns {{includeTerms:string[],excludeTerms:string[],phrases:string[],excludePhrases:string[],ast:object|null}}
 */
export function parseQueryInput(raw) {
  const { ast, errors } = parseBooleanQuery(raw);
  if (errors.length) {
    const message = errors.join(' ');
    throw new Error(message);
  }
  const flattened = flattenQueryAst(ast);
  return { ...flattened, ast };
}

const fallbackTerms = (raw) => String(raw || '')
  .split(/\s+/)
  .map((token) => token.trim())
  .filter(Boolean)
  .map((token) => token.replace(FALLBACK_STRIP_QUOTES, ''))
  .filter(Boolean);

/**
 * Parse query text with grammar-first semantics and controlled fallback.
 * Fallback is only used for recoverable parser errors.
 * @param {string} raw
 * @returns {{parsed:{includeTerms:string[],excludeTerms:string[],phrases:string[],excludePhrases:string[],ast:object|null},strategy:'grammar'|'heuristic-fallback',fallbackReason:string|null}}
 */
export function parseQueryWithFallback(raw) {
  try {
    return {
      parsed: parseQueryInput(raw),
      strategy: 'grammar',
      fallbackReason: null
    };
  } catch (error) {
    const message = String(error?.message || 'query parse failed');
    if (FALLBACK_HARD_ERROR_PATTERN.test(message)) {
      throw error;
    }
    return {
      parsed: {
        includeTerms: fallbackTerms(raw),
        excludeTerms: [],
        phrases: [],
        excludePhrases: [],
        ast: null
      },
      strategy: 'heuristic-fallback',
      fallbackReason: message
    };
  }
}

const normalizeToken = (value) => String(value || '').normalize('NFKD');

const expandQueryToken = (raw, dict, options) => {
  const caseSensitive = options?.caseSensitive === true;
  const normalized = normalizeToken(raw);
  if (!normalized) return [];
  if (caseSensitive) return [normalized];
  if (normalized.length <= 3 || dict.has(normalized)) return [normalized];
  const expanded = splitWordsWithDict(normalized, dict, options);
  return expanded.length ? expanded : [normalized];
};

/**
 * Tokenize raw query terms into identifier tokens.
 * @param {string[]|string|null|undefined} rawTerms
 * @param {Set<string>} dict
 * @returns {string[]}
 */
export function tokenizeQueryTerms(rawTerms, dict, options) {
  const caseSensitive = options?.caseSensitive === true;
  const splitter = caseSensitive ? splitIdPreserveCase : splitId;
  const tokens = [];
  const entries = Array.isArray(rawTerms) ? rawTerms : (rawTerms ? [rawTerms] : []);
  for (const entry of entries) {
    tokens.push(...extractPunctuationTokens(entry));
    const parts = splitter(String(entry || '')).map(normalizeToken).filter(Boolean);
    for (const part of parts) {
      tokens.push(...expandQueryToken(part, dict, options));
    }
  }
  return tokens.filter(Boolean);
}

/**
 * Tokenize a phrase string into dictionary-aware tokens.
 * @param {string} phrase
 * @param {Set<string>} dict
 * @returns {string[]}
 */
export function tokenizePhrase(phrase, dict, options) {
  const caseSensitive = options?.caseSensitive === true;
  const splitter = caseSensitive ? splitIdPreserveCase : splitId;
  const parts = splitter(String(phrase || '')).map(normalizeToken).filter(Boolean);
  const tokens = [];
  tokens.push(...extractPunctuationTokens(phrase));
  for (const part of parts) {
    tokens.push(...expandQueryToken(part, dict, options));
  }
  return tokens.filter(Boolean);
}

/**
 * Build phrase n-grams for a list of phrase token arrays.
 * @param {Array<string[]>} phraseTokens
 * @param {object} [config]
 * @returns {{ngrams:string[],minLen:number|null,maxLen:number|null}}
 */
export function buildPhraseNgrams(phraseTokens, config = {}) {
  const enabled = config.enablePhraseNgrams !== false;
  if (!enabled) return { ngrams: [], minLen: null, maxLen: null };
  const minAllowed = Number.isFinite(Number(config.phraseMinN)) ? Number(config.phraseMinN) : 2;
  const maxAllowed = Number.isFinite(Number(config.phraseMaxN))
    ? Number(config.phraseMaxN)
    : Math.max(minAllowed, 4);
  const ngrams = [];
  let minLen = null;
  let maxLen = null;
  for (const tokens of phraseTokens) {
    if (!Array.isArray(tokens) || tokens.length < 2) continue;
    const len = tokens.length;
    if (len < minAllowed || len > maxAllowed) continue;
    minLen = minLen == null ? len : Math.min(minLen, len);
    maxLen = maxLen == null ? len : Math.max(maxLen, len);
    ngrams.push(...extractNgrams(tokens, len, len));
  }
  return { ngrams, minLen, maxLen };
}
