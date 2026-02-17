export const SCORE_BREAKDOWN_SCHEMA_VERSION = 1;

export const OUTPUT_BUDGET_DEFAULTS = Object.freeze({
  maxBytes: 16 * 1024,
  maxFields: 64,
  maxExplainItems: 64
});

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

export const normalizeOutputBudgetPolicy = (input = null) => {
  const source = input && typeof input === 'object' ? input : {};
  return {
    maxBytes: normalizePositiveInt(source.maxBytes, OUTPUT_BUDGET_DEFAULTS.maxBytes),
    maxFields: normalizePositiveInt(source.maxFields, OUTPUT_BUDGET_DEFAULTS.maxFields),
    maxExplainItems: normalizePositiveInt(source.maxExplainItems, OUTPUT_BUDGET_DEFAULTS.maxExplainItems)
  };
};

const clampExplainItems = (value, maxExplainItems) => {
  if (Array.isArray(value)) {
    return value
      .slice(0, maxExplainItems)
      .map((entry) => clampExplainItems(entry, maxExplainItems));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = clampExplainItems(entry, maxExplainItems);
    }
    return out;
  }
  return value;
};

const clampObjectFields = (value, maxFields) => {
  if (Array.isArray(value)) {
    return value.map((entry) => clampObjectFields(entry, maxFields));
  }
  if (!isPlainObject(value)) return value;
  const out = {};
  const keys = Object.keys(value).slice(0, maxFields);
  for (const key of keys) {
    out[key] = clampObjectFields(value[key], maxFields);
  }
  return out;
};

const byteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const enforceScoreBreakdownByteBudget = (scoreBreakdown, maxBytes) => {
  const prunable = ['graph', 'relation', 'symbol', 'phrase', 'blend', 'rrf', 'ann', 'sparse'];
  const out = { ...scoreBreakdown };
  if (byteSize(out) <= maxBytes) return out;
  for (const key of prunable) {
    if (byteSize(out) <= maxBytes) break;
    if (out[key] == null) continue;
    out[key] = null;
  }
  if (byteSize(out) <= maxBytes) return out;
  if (isPlainObject(out.selected)) {
    out.selected = {
      type: typeof out.selected.type === 'string' ? out.selected.type : null,
      score: Number.isFinite(Number(out.selected.score)) ? Number(out.selected.score) : null
    };
  }
  if (byteSize(out) <= maxBytes) return out;
  out.selected = null;
  return out;
};

export const applyScoreBreakdownBudget = (scoreBreakdown, policy = null) => {
  if (!isPlainObject(scoreBreakdown)) return scoreBreakdown;
  const budget = normalizeOutputBudgetPolicy(policy);
  let out = clampExplainItems(scoreBreakdown, budget.maxExplainItems);
  out = clampObjectFields(out, budget.maxFields);
  out = enforceScoreBreakdownByteBudget(out, budget.maxBytes);
  return out;
};

export const createScoreBreakdown = (components = {}, policy = null) => {
  const base = {
    schemaVersion: SCORE_BREAKDOWN_SCHEMA_VERSION,
    selected: components.selected || null,
    sparse: components.sparse || null,
    ann: components.ann || null,
    rrf: components.rrf || null,
    blend: components.blend || null,
    symbol: components.symbol || null,
    phrase: components.phrase || null,
    relation: components.relation || null,
    graph: components.graph || null
  };
  return applyScoreBreakdownBudget(base, policy);
};

const clampPayloadStats = (stats, budget) => {
  if (!isPlainObject(stats)) return stats;
  const out = { ...stats };
  if (Array.isArray(out.pipeline) && out.pipeline.length > budget.maxExplainItems) {
    out.pipeline = out.pipeline.slice(0, budget.maxExplainItems);
  }
  return clampObjectFields(out, budget.maxFields);
};

export const applyOutputBudgetPolicy = (payload, policy = null) => {
  if (!isPlainObject(payload)) return payload;
  const budget = normalizeOutputBudgetPolicy(policy);
  const out = { ...payload };
  for (const mode of ['prose', 'extractedProse', 'code', 'records']) {
    const hits = Array.isArray(out[mode]) ? out[mode] : null;
    if (!hits) continue;
    out[mode] = hits.map((hit) => {
      if (!isPlainObject(hit)) return hit;
      if (!isPlainObject(hit.scoreBreakdown)) return hit;
      return {
        ...hit,
        scoreBreakdown: applyScoreBreakdownBudget(hit.scoreBreakdown, budget)
      };
    });
  }
  if (isPlainObject(out.stats)) {
    out.stats = clampPayloadStats(out.stats, budget);
  }
  return out;
};
