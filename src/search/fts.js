/**
 * Resolve FTS5 bm25 weights from a profile or config override.
 * @param {string} profile
 * @param {object|number[]|null} config
 * @returns {number[]}
 */
export function resolveFtsWeights(profile, config) {
  const profiles = {
    balanced: { file: 0.2, name: 1.5, kind: 0.6, headline: 2.0, tokens: 1.0 },
    headline: { file: 0.1, name: 1.2, kind: 0.4, headline: 3.0, tokens: 1.0 },
    name: { file: 0.2, name: 2.5, kind: 0.8, headline: 1.2, tokens: 1.0 }
  };
  const base = profiles[profile] || profiles.balanced;

  if (Array.isArray(config)) {
    const values = config.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (values.length >= 6) return values.slice(0, 6);
    if (values.length === 5) return [0, ...values];
  } else if (config && typeof config === 'object') {
    const merged = { ...base };
    for (const key of ['file', 'name', 'kind', 'headline', 'tokens']) {
      if (Number.isFinite(Number(config[key]))) merged[key] = Number(config[key]);
    }
    return [0, merged.file, merged.name, merged.kind, merged.headline, merged.tokens];
  }

  return [0, base.file, base.name, base.kind, base.headline, base.tokens];
}

/**
 * Build a bm25(chunks_fts, ...) SQL expression from weights.
 * @param {number[]} weights
 * @returns {string}
 */
export function buildFtsBm25Expr(weights) {
  const safe = weights.map((val) => (Number.isFinite(val) ? val : 1));
  return `bm25(chunks_fts, ${safe.join(', ')})`;
}
