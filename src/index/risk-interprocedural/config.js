const DEFAULT_CONFIG = {
  enabled: false,
  summaryOnly: false,
  strictness: 'conservative',
  sanitizerPolicy: 'terminate',
  emitArtifacts: 'jsonl',
  caps: {
    maxDepth: 4,
    maxPathsPerPair: 3,
    maxTotalFlows: 5000,
    maxCallSitesPerEdge: 3,
    maxEdgeExpansions: 200000,
    maxMs: 2500
  }
};

const clampInt = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return Math.min(Math.max(floored, min), max);
};

const normalizeEmitArtifacts = (value) => {
  if (typeof value !== 'string') return DEFAULT_CONFIG.emitArtifacts;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'none') return 'none';
  if (normalized === 'jsonl') return 'jsonl';
  return DEFAULT_CONFIG.emitArtifacts;
};

const normalizeStrictness = (value) => {
  if (value === 'conservative' || value === 'argAware') return value;
  return DEFAULT_CONFIG.strictness;
};

const normalizeSanitizerPolicy = (value) => {
  if (value === 'terminate' || value === 'weaken') return value;
  return DEFAULT_CONFIG.sanitizerPolicy;
};

const normalizeCaps = (rawCaps = {}) => {
  const caps = {
    maxDepth: clampInt(rawCaps.maxDepth, 1, 20, DEFAULT_CONFIG.caps.maxDepth),
    maxPathsPerPair: clampInt(rawCaps.maxPathsPerPair, 1, 50, DEFAULT_CONFIG.caps.maxPathsPerPair),
    maxTotalFlows: clampInt(rawCaps.maxTotalFlows, 0, 1_000_000, DEFAULT_CONFIG.caps.maxTotalFlows),
    maxCallSitesPerEdge: clampInt(rawCaps.maxCallSitesPerEdge, 1, 50, DEFAULT_CONFIG.caps.maxCallSitesPerEdge),
    maxEdgeExpansions: clampInt(rawCaps.maxEdgeExpansions, 10_000, 10_000_000, DEFAULT_CONFIG.caps.maxEdgeExpansions),
    maxMs: DEFAULT_CONFIG.caps.maxMs
  };

  if (rawCaps.maxMs === null) {
    caps.maxMs = null;
  } else {
    caps.maxMs = clampInt(rawCaps.maxMs, 10, 60_000, DEFAULT_CONFIG.caps.maxMs);
  }

  return caps;
};

export const normalizeRiskInterproceduralConfig = (raw, { mode } = {}) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const enabled = input.enabled === true;
  const summaryOnly = input.summaryOnly === true;
  const strictness = normalizeStrictness(input.strictness);
  const sanitizerPolicy = normalizeSanitizerPolicy(input.sanitizerPolicy);
  const emitArtifacts = normalizeEmitArtifacts(input.emitArtifacts);
  const caps = normalizeCaps(input.caps || {});

  const normalized = {
    enabled,
    summaryOnly,
    strictness,
    sanitizerPolicy,
    emitArtifacts,
    caps
  };

  if (mode && mode !== 'code') {
    normalized.enabled = false;
  }

  return normalized;
};
