/**
 * Resolve FTS5 bm25 weights from a profile or config override.
 * @param {string} profile
 * @param {object|number[]|null} config
 * @returns {number[]}
 */
export function resolveFtsWeights(profile, config) {
  const profiles = {
    balanced: {
      file: 0.2,
      name: 1.5,
      signature: 1.2,
      kind: 0.6,
      headline: 1.5,
      doc: 1.8,
      tokens: 1.0
    },
    headline: {
      file: 0.1,
      name: 1.2,
      signature: 1.0,
      kind: 0.4,
      headline: 3.0,
      doc: 2.2,
      tokens: 1.0
    },
    name: {
      file: 0.2,
      name: 2.5,
      signature: 1.6,
      kind: 0.8,
      headline: 1.2,
      doc: 1.4,
      tokens: 1.0
    }
  };
  const base = profiles[profile] || profiles.balanced;
  if (Array.isArray(config)) {
    const values = config.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (values.length >= 8) return values.slice(0, 8);
    if (values.length === 7) return [0, ...values];
    if (values.length === 6) {
      const [, file, name, kind, headline, tokens] = values;
      return [
        0,
        file ?? base.file,
        name ?? base.name,
        base.signature,
        kind ?? base.kind,
        headline ?? base.headline,
        base.doc,
        tokens ?? base.tokens
      ];
    }
    if (values.length === 5) {
      const [file, name, kind, headline, tokens] = values;
      return [
        0,
        file ?? base.file,
        name ?? base.name,
        base.signature,
        kind ?? base.kind,
        headline ?? base.headline,
        base.doc,
        tokens ?? base.tokens
      ];
    }
  } else if (config && typeof config === 'object') {
    const merged = { ...base };
    for (const key of ['file', 'name', 'signature', 'kind', 'headline', 'doc', 'tokens']) {
      if (Number.isFinite(Number(config[key]))) merged[key] = Number(config[key]);
    }
    if (Number.isFinite(Number(config.body))) merged.tokens = Number(config.body);
    return [0, merged.file, merged.name, merged.signature, merged.kind, merged.headline, merged.doc, merged.tokens];
  }

  return [0, base.file, base.name, base.signature, base.kind, base.headline, base.doc, base.tokens];
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
