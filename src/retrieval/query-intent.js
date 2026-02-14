const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*):\/\/\S+/i;
const WWW_URL_PATTERN = /\bwww\.[^\s/$.?#].[^\s]*/i;
const PATH_PREFIX_PATTERN = /(^|[\s"'`])(\.{1,2}[\\/]|[A-Za-z]:[\\/]|~[\\/]|\/(?!\/))/;
const PATH_PREFIX_TOKEN_PATTERN = /^(\.{1,2}[\\/]|[A-Za-z]:[\\/]|~[\\/]|\/(?!\/))/;
const TRAILING_PATH_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,12}$/;
const CODE_TOKEN_PATTERN = /[{}()[\];:<>.=]|=>|->|::|\+\+|--|\|\||&&/;
const CAMEL_PATTERN = /[a-z][A-Z]/;
const SNAKE_PATTERN = /_/;

const DEFAULT_FIELD_WEIGHTS = {
  code: { name: 2.0, signature: 1.5, doc: 1.2, comment: 0.6, body: 1.0, keyword: 0.25, operator: 0.05 },
  prose: { name: 1.2, signature: 0.9, doc: 2.1, comment: 1.8, body: 1.7, keyword: 0.2, operator: 0.05 },
  path: { name: 2.4, signature: 1.7, doc: 0.9, comment: 0.4, body: 0.7, keyword: 0.2, operator: 0.05 },
  url: { name: 1.1, signature: 0.8, doc: 2.0, comment: 1.8, body: 1.7, keyword: 0.2, operator: 0.05 },
  mixed: { name: 1.8, signature: 1.3, doc: 1.6, comment: 1.2, body: 1.2, keyword: 0.25, operator: 0.05 }
};

const normalizeTokenCandidate = (token) => String(token || '')
  .trim()
  .replace(/^[`"'([{]+/, '')
  .replace(/[`"')\]},;:.!?]+$/, '');

const isUrlToken = (token) => URL_PATTERN.test(token) || WWW_URL_PATTERN.test(token);

const isPathLikeToken = (token) => {
  if (!token || isUrlToken(token)) return false;
  if (!/[\\/]/.test(token)) return false;
  if (/^\/\//.test(token)) return false;
  const segments = token.split(/[\\/]+/).filter(Boolean);
  if (segments.length < 2) return false;
  const hasPrefix = PATH_PREFIX_TOKEN_PATTERN.test(token);
  const tail = segments[segments.length - 1] || '';
  const hasExtension = TRAILING_PATH_EXTENSION_PATTERN.test(tail);
  return hasPrefix || hasExtension || segments.length >= 3;
};

const detectSignals = (query, tokens) => {
  const normalized = String(query || '');
  const words = tokens.filter((token) => /^[a-z0-9_]+$/i.test(token));
  const symbolTokens = tokens.filter((token) => /[^a-z0-9_]/i.test(token));
  const tokenCandidates = normalized
    .split(/\s+/)
    .map(normalizeTokenCandidate)
    .filter(Boolean);
  const hasUrl = URL_PATTERN.test(normalized)
    || WWW_URL_PATTERN.test(normalized)
    || tokenCandidates.some(isUrlToken);
  const pathLikeCount = hasUrl
    ? 0
    : tokenCandidates.filter(isPathLikeToken).length;
  const hasPathPrefix = !hasUrl && PATH_PREFIX_PATTERN.test(normalized);
  const hasPath = !hasUrl && (hasPathPrefix || pathLikeCount > 0);
  const hasCodePunctuation = CODE_TOKEN_PATTERN.test(normalized)
    || symbolTokens.length > 0;
  const hasCamel = CAMEL_PATTERN.test(normalized);
  const hasSnake = SNAKE_PATTERN.test(normalized);
  const wordCount = words.length;
  return {
    hasPath,
    pathLikeCount,
    hasUrl,
    hasCodePunctuation,
    hasCamel,
    hasSnake,
    wordCount,
    symbolCount: symbolTokens.length
  };
};

export const classifyQuery = ({
  query,
  tokens = [],
  phrases = [],
  filters = {},
  parseStrategy = 'grammar',
  parseFallbackReason = null
}) => {
  const signals = detectSignals(query, tokens);
  const scores = { code: 0, prose: 0, path: 0, url: 0 };

  if (signals.hasPath || filters?.file || filters?.path) scores.path += 3;
  if (signals.hasUrl) {
    scores.url += 4;
    scores.prose += 1;
  }
  if (signals.hasCodePunctuation) scores.code += 2;
  if (signals.hasCamel || signals.hasSnake) scores.code += 1;
  if (signals.wordCount >= 3) scores.prose += 2;
  if (phrases.length >= 2) scores.prose += 1;
  if (signals.symbolCount >= 2) scores.code += 1;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = sorted[0];
  const secondScore = sorted[1]?.[1] ?? 0;
  let type = topScore === 0 ? 'mixed' : topType;
  if (topScore >= 2 && (topScore - secondScore <= 1)) {
    type = 'mixed';
  }
  if (scores.path >= 3 && scores.path >= scores.code && scores.path >= scores.prose && scores.path >= scores.url) {
    type = 'path';
  }
  if (scores.url >= 4 && scores.url >= scores.path && scores.url >= scores.code && scores.url >= scores.prose) {
    type = 'url';
  }
  const vectorMode = type === 'prose' || type === 'url'
    ? 'doc'
    : (type === 'code' || type === 'path' ? 'code' : null);

  const strategy = parseStrategy === 'heuristic-fallback' ? 'heuristic-fallback' : 'grammar';
  const fallbackReason = strategy === 'heuristic-fallback'
    ? (parseFallbackReason || 'query_parser_failed')
    : null;
  const baseReason = type === 'mixed' ? 'signals mixed or weak' : `dominant ${type} signals`;
  const reason = fallbackReason
    ? `${baseReason}; fallback=${fallbackReason}`
    : baseReason;

  return {
    type,
    scores,
    signals,
    vectorMode,
    reason,
    parseStrategy: strategy,
    parseFallbackReason: fallbackReason
  };
};

export const resolveIntentVectorMode = (denseVectorMode, intent) => {
  if (denseVectorMode !== 'auto') return denseVectorMode;
  if (intent?.vectorMode) return intent.vectorMode;
  return denseVectorMode;
};

export const resolveIntentFieldWeights = (fieldWeightsInput, intent) => {
  if (fieldWeightsInput === false) return null;
  const key = intent?.type && DEFAULT_FIELD_WEIGHTS[intent.type]
    ? intent.type
    : 'code';
  const resolved = { ...DEFAULT_FIELD_WEIGHTS[key] };
  if (fieldWeightsInput && typeof fieldWeightsInput === 'object') {
    for (const [field, value] of Object.entries(resolved)) {
      const override = Number(fieldWeightsInput[field]);
      if (Number.isFinite(override)) resolved[field] = override;
    }
  }
  return resolved;
};
