const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*):\/\/\S+/i;
const WWW_URL_PATTERN = /\bwww\.[^\s/$.?#].[^\s]*/i;
const PATH_PREFIX_PATTERN = /(^|[\s"'`])(\.{1,2}[\\/]|[A-Za-z]:[\\/]|~[\\/]|\/(?!\/))/;
const PATH_PREFIX_TOKEN_PATTERN = /^(\.{1,2}[\\/]|[A-Za-z]:[\\/]|~[\\/]|\/(?!\/))/;
const TRAILING_PATH_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,12}$/;
const CODE_TOKEN_PATTERN = /[{}()[\];:<>.=]|=>|->|::|\+\+|--|\|\||&&/;
const CAMEL_PATTERN = /[a-z][A-Z]/;
const SNAKE_PATTERN = /_/;
const INTENT_TYPES = ['code', 'prose', 'path', 'url', 'mixed'];
/**
 * Confidence cutoffs used by both intent classification and trust-surface
 * rendering. Keep these centralized so bucket semantics stay consistent across
 * ranking, explanation, and contract tests.
 */
export const INTENT_CONFIDENCE_BUCKET_THRESHOLDS = Object.freeze({
  high: 0.78,
  medium: 0.56
});

const DEFAULT_FIELD_WEIGHTS = {
  code: { name: 2.0, signature: 1.5, doc: 1.2, comment: 0.6, body: 1.0, keyword: 0.25, operator: 0.05 },
  prose: { name: 1.2, signature: 0.9, doc: 2.1, comment: 1.8, body: 1.7, keyword: 0.2, operator: 0.05 },
  path: { name: 2.4, signature: 1.7, doc: 0.9, comment: 0.4, body: 0.7, keyword: 0.2, operator: 0.05 },
  url: { name: 1.1, signature: 0.8, doc: 2.0, comment: 1.8, body: 1.7, keyword: 0.2, operator: 0.05 },
  mixed: { name: 1.8, signature: 1.3, doc: 1.6, comment: 1.2, body: 1.2, keyword: 0.25, operator: 0.05 }
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const resolveConfidenceBucket = (confidence) => {
  if (confidence >= INTENT_CONFIDENCE_BUCKET_THRESHOLDS.high) return 'high';
  if (confidence >= INTENT_CONFIDENCE_BUCKET_THRESHOLDS.medium) return 'medium';
  return 'low';
};

/**
 * Build per-class confidence values with a calibrated top-class confidence.
 * This keeps deterministic values for all intent classes while still exposing
 * a stronger calibrated confidence for the dominant class.
 * @param {object} input
 * @returns {Record<string, number>}
 */
const buildConfidenceByType = ({
  scores,
  dominantType,
  topScore,
  secondScore,
  signals,
  parseStrategy
}) => {
  const base = {
    code: Math.max(0, Number(scores.code) || 0) + 1,
    prose: Math.max(0, Number(scores.prose) || 0) + 1,
    path: Math.max(0, Number(scores.path) || 0) + 1,
    url: Math.max(0, Number(scores.url) || 0) + 1,
    mixed: 1 + (
      topScore === 0
        ? 3
        : ((topScore - secondScore) <= 1 ? 2 : 0)
    )
  };
  if (parseStrategy === 'heuristic-fallback') {
    base.mixed += 1;
  }
  const strongestSignalCount = Number(Boolean(signals.hasPath))
    + Number(Boolean(signals.hasUrl))
    + Number(Boolean(signals.hasCodePunctuation))
    + Number(Boolean(signals.hasCamel || signals.hasSnake))
    + Number((Number(signals.wordCount) || 0) >= 3);
  const topNorm = clamp01(topScore / 6);
  const marginNorm = clamp01((topScore - secondScore) / 4);
  const signalNorm = clamp01(strongestSignalCount / 5);
  let calibratedTop = 0.42 + (0.28 * topNorm) + (0.2 * marginNorm) + (0.08 * signalNorm);
  if (dominantType === 'path' && signals.hasPath) calibratedTop += 0.1;
  if (dominantType === 'url' && signals.hasUrl) calibratedTop += 0.12;
  if (dominantType === 'code' && (signals.hasCodePunctuation || signals.hasCamel || signals.hasSnake)) {
    calibratedTop += 0.06;
  }
  if (dominantType === 'prose' && (Number(signals.wordCount) || 0) >= 4) {
    calibratedTop += 0.06;
  }
  if (dominantType === 'mixed') calibratedTop -= 0.18;
  if (parseStrategy === 'heuristic-fallback') calibratedTop -= 0.06;
  calibratedTop = clamp01(calibratedTop);

  const dominantKey = INTENT_TYPES.includes(dominantType) ? dominantType : 'mixed';
  const otherKeys = INTENT_TYPES.filter((key) => key !== dominantKey);
  const otherTotal = otherKeys.reduce((sum, key) => sum + base[key], 0);
  const remainder = 1 - calibratedTop;
  const confidenceByType = Object.create(null);
  confidenceByType[dominantKey] = calibratedTop;
  for (const key of otherKeys) {
    confidenceByType[key] = otherTotal > 0
      ? (base[key] / otherTotal) * remainder
      : remainder / otherKeys.length;
  }
  return confidenceByType;
};

const resolveEffectiveIntentType = (intent) => {
  const effective = String(intent?.effectiveType || '').trim();
  if (DEFAULT_FIELD_WEIGHTS[effective]) return effective;
  const legacy = String(intent?.type || '').trim();
  if (DEFAULT_FIELD_WEIGHTS[legacy]) return legacy;
  return 'code';
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
  const confidenceByType = buildConfidenceByType({
    scores,
    dominantType: type,
    topScore,
    secondScore,
    signals,
    parseStrategy
  });
  const confidence = clamp01(confidenceByType[type] || 0);
  const confidenceValues = Object.entries(confidenceByType)
    .sort((a, b) => b[1] - a[1]);
  const confidenceMargin = clamp01((confidenceValues[0]?.[1] || 0) - (confidenceValues[1]?.[1] || 0));
  const confidenceBucket = resolveConfidenceBucket(confidence);
  const abstain = confidenceBucket === 'low';
  const effectiveType = abstain ? 'mixed' : type;
  const vectorMode = effectiveType === 'prose' || effectiveType === 'url'
    ? 'doc'
    : (effectiveType === 'code' || effectiveType === 'path' ? 'code' : null);

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
    parseFallbackReason: fallbackReason,
    effectiveType,
    confidence,
    confidenceByType,
    confidenceMargin,
    confidenceBucket,
    abstain,
    state: abstain ? 'uncertain' : 'certain',
    abstainReason: abstain ? 'low_confidence' : null,
    calibrationVersion: 1
  };
};

export const resolveIntentVectorMode = (denseVectorMode, intent) => {
  if (denseVectorMode !== 'auto') return denseVectorMode;
  if (intent?.vectorMode) return intent.vectorMode;
  return denseVectorMode;
};

export const resolveIntentFieldWeights = (fieldWeightsInput, intent) => {
  if (fieldWeightsInput === false) return null;
  const key = resolveEffectiveIntentType(intent);
  const resolved = { ...DEFAULT_FIELD_WEIGHTS[key] };
  if (fieldWeightsInput && typeof fieldWeightsInput === 'object') {
    for (const [field, value] of Object.entries(resolved)) {
      const override = Number(fieldWeightsInput[field]);
      if (Number.isFinite(override)) resolved[field] = override;
    }
  }
  return resolved;
};
