const PATH_PATTERN = /(^|[\s"'`])(\.{1,2}[\\/]|[A-Za-z]:[\\/]|~[\\/]|\/)/;
const CODE_TOKEN_PATTERN = /[{}()[\];:<>.=]|=>|->|::|\+\+|--|\|\||&&/;
const CAMEL_PATTERN = /[a-z][A-Z]/;
const SNAKE_PATTERN = /_/;

const DEFAULT_FIELD_WEIGHTS = {
  code: { name: 2.0, signature: 1.5, doc: 1.2, comment: 0.6, body: 1.0 },
  prose: { name: 1.2, signature: 0.9, doc: 2.1, comment: 1.8, body: 1.7 },
  path: { name: 2.4, signature: 1.7, doc: 0.9, comment: 0.4, body: 0.7 },
  mixed: { name: 1.8, signature: 1.3, doc: 1.6, comment: 1.2, body: 1.2 }
};

const detectSignals = (query, tokens) => {
  const normalized = query || '';
  const words = tokens.filter((token) => /^[a-z0-9_]+$/i.test(token));
  const symbolTokens = tokens.filter((token) => /[^a-z0-9_]/i.test(token));
  const hasPath = PATH_PATTERN.test(normalized) || /[\\/]/.test(normalized);
  const hasCodePunctuation = CODE_TOKEN_PATTERN.test(normalized)
    || symbolTokens.length > 0;
  const hasCamel = CAMEL_PATTERN.test(normalized);
  const hasSnake = SNAKE_PATTERN.test(normalized);
  const wordCount = words.length;
  return {
    hasPath,
    hasCodePunctuation,
    hasCamel,
    hasSnake,
    wordCount,
    symbolCount: symbolTokens.length
  };
};

export const classifyQuery = ({ query, tokens = [], phrases = [], filters = {} }) => {
  const signals = detectSignals(query, tokens);
  const scores = { code: 0, prose: 0, path: 0 };

  if (signals.hasPath || filters?.file || filters?.path) scores.path += 3;
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
  if (scores.path >= 3 && scores.path >= scores.code && scores.path >= scores.prose) {
    type = 'path';
  }
  const vectorMode = type === 'prose' ? 'doc' : (type === 'code' || type === 'path' ? 'code' : null);

  return {
    type,
    scores,
    signals,
    vectorMode,
    reason: type === 'mixed' ? 'signals mixed or weak' : `dominant ${type} signals`
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
