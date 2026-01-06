const normalizeMultiplier = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function normalizeEmbeddingBatchMultipliers(raw = {}, fallback = {}) {
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
  const resolvedBase = Number.isFinite(baseSize) ? baseSize : 0;
  if (!resolvedBase || !languageId || !multipliers) return baseSize;
  const multiplier = normalizeMultiplier(multipliers[String(languageId).toLowerCase()]);
  if (!multiplier) return baseSize;
  return Math.max(1, Math.floor(resolvedBase * multiplier));
}
