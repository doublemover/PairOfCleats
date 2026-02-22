const DENSE_VECTOR_MODES = new Set(['merged', 'code', 'doc', 'auto']);

/**
 * Normalize dense vector mode selector.
 * @param {unknown} value
 * @param {string|null} [fallback=null]
 * @returns {'merged'|'code'|'doc'|'auto'|null}
 */
export const normalizeDenseVectorMode = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return DENSE_VECTOR_MODES.has(normalized) ? normalized : fallback;
};
