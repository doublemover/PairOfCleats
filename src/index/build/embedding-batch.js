const normalizeMultiplier = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function normalizeEmbeddingBatchMultipliers(raw = {}, fallback = {}) {
  // Fallback values are applied first, user-provided values override them.
  const output = {};
  for (const source of [fallback, raw]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      const multiplier = normalizeMultiplier(value);
      if (!multiplier) continue;
      output[key.toLowerCase()] = multiplier;
    }
  }
  return output;
}

export function resolveEmbeddingBatchSize(baseSize, languageId, multipliers = null) {
  const resolvedBase = Number.isFinite(Number(baseSize)) ? Number(baseSize) : 0;
  if (!resolvedBase || !languageId || !multipliers) return resolvedBase || baseSize;
  const multiplier = normalizeMultiplier(multipliers[String(languageId).toLowerCase()]);
  if (!multiplier) return resolvedBase || baseSize;
  return Math.max(1, Math.floor(resolvedBase * multiplier));
}
