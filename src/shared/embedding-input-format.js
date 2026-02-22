const E5_MODEL_PATTERN = /(^|\/)(?:multilingual-)?e5(?:-|_|$)/i;
const BGE_MODEL_PATTERN = /(^|\/)bge-(?:small|base|large|m3|micro|mini|maxi|en|zh|multilingual)/i;

export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
export const E5_QUERY_PREFIX = 'query: ';
export const E5_PASSAGE_PREFIX = 'passage: ';

const normalizeModelId = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const shouldApplyPrefix = (text, prefix) => {
  if (!prefix) return false;
  const source = String(text ?? '').trim().toLowerCase();
  return source !== '' && !source.startsWith(prefix.trim().toLowerCase());
};

const applyPrefix = (text, prefix) => {
  const source = String(text ?? '');
  if (!prefix || !shouldApplyPrefix(source, prefix)) return source;
  return `${prefix}${source}`;
};

/**
 * Resolve model-aware input formatting policy for query/passage embeddings.
 *
 * Why this exists:
 * - E5 models are trained with asymmetric "query:" / "passage:" prefixes.
 * - BGE retrieval quality improves when query instructions are prepended.
 * - Other model families should not be modified implicitly.
 *
 * @param {string|null|undefined} modelId
 * @returns {{
 *   family:'default'|'e5'|'bge',
 *   queryPrefix:string|null,
 *   passagePrefix:string|null
 * }}
 */
export const resolveEmbeddingInputFormatting = (modelId) => {
  const normalized = normalizeModelId(modelId);
  if (E5_MODEL_PATTERN.test(normalized)) {
    return {
      family: 'e5',
      queryPrefix: E5_QUERY_PREFIX,
      passagePrefix: E5_PASSAGE_PREFIX
    };
  }
  if (BGE_MODEL_PATTERN.test(normalized)) {
    return {
      family: 'bge',
      queryPrefix: BGE_QUERY_PREFIX,
      passagePrefix: null
    };
  }
  return {
    family: 'default',
    queryPrefix: null,
    passagePrefix: null
  };
};

/**
 * Format one text payload according to model-aware query/passage policy.
 *
 * @param {string} text
 * @param {{
 *   modelId?:string|null,
 *   kind?:'query'|'passage',
 *   formatting?:{queryPrefix?:string|null,passagePrefix?:string|null}
 * }} [options]
 * @returns {string}
 */
export const formatEmbeddingInput = (text, options = {}) => {
  const kind = options.kind === 'query' ? 'query' : 'passage';
  const formatting = options.formatting && typeof options.formatting === 'object'
    ? options.formatting
    : resolveEmbeddingInputFormatting(options.modelId);
  if (kind === 'query') {
    return applyPrefix(text, formatting.queryPrefix || null);
  }
  return applyPrefix(text, formatting.passagePrefix || null);
};

/**
 * Format a batch of embedding payloads using model-aware policy.
 *
 * @param {string[]} texts
 * @param {{
 *   modelId?:string|null,
 *   kind?:'query'|'passage',
 *   formatting?:{queryPrefix?:string|null,passagePrefix?:string|null}
 * }} [options]
 * @returns {string[]}
 */
export const formatEmbeddingInputs = (texts, options = {}) => {
  const list = Array.isArray(texts) ? texts : [];
  if (!list.length) return [];
  const formatting = options.formatting && typeof options.formatting === 'object'
    ? options.formatting
    : resolveEmbeddingInputFormatting(options.modelId);
  const kind = options.kind === 'query' ? 'query' : 'passage';
  return list.map((text) => formatEmbeddingInput(text, { ...options, kind, formatting }));
};
