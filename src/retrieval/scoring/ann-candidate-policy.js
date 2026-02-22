import { ANN_PROVIDER_IDS } from '../ann/types.js';

export const ANN_CANDIDATE_POLICY_SCHEMA_VERSION = 1;

export const ANN_CANDIDATE_POLICY_REASONS = Object.freeze({
  NO_CANDIDATES: 'noCandidates',
  TOO_LARGE: 'tooLarge',
  TOO_SMALL_NO_FILTERS: 'tooSmallNoFilters',
  FILTERS_ACTIVE_ALLOWED_IDX: 'filtersActiveAllowedIdx',
  OK: 'ok'
});

export const ANN_ADAPTIVE_ROUTE = Object.freeze({
  VECTOR: 'vector',
  SPARSE: 'sparse'
});

export const ANN_ADAPTIVE_ROUTE_REASONS = Object.freeze({
  VECTOR_ONLY_REQUIRED: 'vectorOnlyRequired',
  ADAPTIVE_DISABLED: 'adaptiveDisabled',
  FILTERS_ACTIVE: 'filtersActive',
  NO_PROVIDERS: 'noProviders',
  SMALL_INDEX_BYPASS: 'smallIndexBypass',
  LOW_CANDIDATE_BYPASS: 'lowCandidateBypass',
  QUERY_CLASS_BYPASS: 'queryClassBypass',
  ROUTE_VECTOR: 'routeVector'
});

export const ANN_ADAPTIVE_ORDER_REASONS = Object.freeze({
  UNCHANGED: 'unchanged',
  SMALL_CANDIDATE_SET: 'smallCandidateSet',
  LARGE_INDEX: 'largeIndex',
  SYMBOL_HEAVY_QUERY: 'symbolHeavyQuery',
  PROSE_HEAVY_MODE: 'proseHeavyMode'
});

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const defaultToSet = (value) => {
  if (!value) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  if (typeof value[Symbol.iterator] === 'function') return new Set(value);
  return null;
};

const defaultGetSize = (value) => {
  if (!value) return 0;
  if (value instanceof Set) return value.size;
  if (Array.isArray(value)) return value.length;
  if (Number.isFinite(value?.size)) return Number(value.size);
  if (typeof value?.size === 'function') {
    const resolved = value.size();
    if (Number.isFinite(resolved)) return Number(resolved);
  }
  if (typeof value?.getSize === 'function') {
    const resolved = value.getSize();
    if (Number.isFinite(resolved)) return Number(resolved);
  }
  return null;
};

const defaultHasId = (value, id) => {
  if (!value) return false;
  if (value instanceof Set) return value.has(id);
  if (typeof value.has === 'function') return value.has(id);
  if (typeof value.contains === 'function') return value.contains(id);
  if (typeof value.includes === 'function') return value.includes(id);
  return false;
};

const intersectSets = (left, right) => {
  if (!(left instanceof Set) || !(right instanceof Set)) return null;
  if (!left.size || !right.size) return new Set();
  const out = new Set();
  const iterate = left.size <= right.size ? left : right;
  const lookup = iterate === left ? right : left;
  for (const id of iterate) {
    if (lookup.has(id)) out.add(id);
  }
  return out;
};

const normalizeNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const clampInt = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const resolveQueryClass = (queryTokens) => {
  const tokens = Array.isArray(queryTokens)
    ? queryTokens.filter((token) => typeof token === 'string' && token.trim())
    : [];
  let charCount = 0;
  let symbolCount = 0;
  for (const token of tokens) {
    for (const ch of token) {
      charCount += 1;
      if (/[^0-9A-Za-z_]/.test(ch)) symbolCount += 1;
    }
  }
  const symbolRatio = charCount > 0 ? (symbolCount / charCount) : 0;
  const tokenCount = tokens.length;
  const short = tokenCount > 0 && tokenCount <= 2 && charCount <= 18;
  return {
    tokenCount,
    charCount,
    symbolRatio,
    symbolHeavy: symbolRatio >= 0.3,
    short
  };
};

const reorderWithPreference = (baseOrder, preferredOrder) => {
  const ranked = new Map();
  preferredOrder.forEach((backend, index) => ranked.set(backend, index));
  const withIndex = baseOrder.map((backend, index) => ({ backend, index }));
  withIndex.sort((a, b) => {
    const rankA = ranked.has(a.backend) ? ranked.get(a.backend) : Number.MAX_SAFE_INTEGER;
    const rankB = ranked.has(b.backend) ? ranked.get(b.backend) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.index - b.index;
  });
  return withIndex.map((entry) => entry.backend);
};

const resolveOrderHeuristic = ({
  mode,
  candidateSize,
  docCount,
  queryClass
}) => {
  if (queryClass.symbolHeavy) {
    return {
      reason: ANN_ADAPTIVE_ORDER_REASONS.SYMBOL_HEAVY_QUERY,
      order: [
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.DENSE
      ]
    };
  }
  if (docCount >= 50000 || candidateSize >= 10000) {
    return {
      reason: ANN_ADAPTIVE_ORDER_REASONS.LARGE_INDEX,
      order: [
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.DENSE
      ]
    };
  }
  if (candidateSize >= 16 && candidateSize <= 128) {
    return {
      reason: ANN_ADAPTIVE_ORDER_REASONS.SMALL_CANDIDATE_SET,
      order: [
        ANN_PROVIDER_IDS.DENSE,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.LANCEDB
      ]
    };
  }
  if (mode === 'prose' || mode === 'extracted-prose') {
    return {
      reason: ANN_ADAPTIVE_ORDER_REASONS.PROSE_HEAVY_MODE,
      order: [
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.DENSE
      ]
    };
  }
  return {
    reason: ANN_ADAPTIVE_ORDER_REASONS.UNCHANGED,
    order: []
  };
};

const resolveAdaptiveRoute = ({
  adaptiveProvidersEnabled,
  vectorOnlyProfile,
  filtersActive,
  providerCount,
  docCount,
  candidateSize,
  queryClass
}) => {
  if (vectorOnlyProfile) {
    return {
      route: ANN_ADAPTIVE_ROUTE.VECTOR,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.VECTOR_ONLY_REQUIRED
    };
  }
  if (!adaptiveProvidersEnabled) {
    return {
      route: ANN_ADAPTIVE_ROUTE.VECTOR,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.ADAPTIVE_DISABLED
    };
  }
  if (filtersActive) {
    return {
      route: ANN_ADAPTIVE_ROUTE.VECTOR,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.FILTERS_ACTIVE
    };
  }
  if (providerCount <= 0) {
    return {
      route: ANN_ADAPTIVE_ROUTE.VECTOR,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.NO_PROVIDERS
    };
  }
  if (docCount > 0 && docCount <= 64) {
    return {
      route: ANN_ADAPTIVE_ROUTE.SPARSE,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.SMALL_INDEX_BYPASS
    };
  }
  if (candidateSize > 0 && candidateSize <= 16) {
    return {
      route: ANN_ADAPTIVE_ROUTE.SPARSE,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.LOW_CANDIDATE_BYPASS
    };
  }
  if (queryClass.short && queryClass.symbolHeavy && candidateSize > 0 && candidateSize <= 64) {
    return {
      route: ANN_ADAPTIVE_ROUTE.SPARSE,
      reason: ANN_ADAPTIVE_ROUTE_REASONS.QUERY_CLASS_BYPASS
    };
  }
  return {
    route: ANN_ADAPTIVE_ROUTE.VECTOR,
    reason: ANN_ADAPTIVE_ROUTE_REASONS.ROUTE_VECTOR
  };
};

/**
 * Resolve per-query ANN route, backend ordering, and budget.
 * This is a lightweight heuristic policy (the "learned" path comes from
 * provider runtime EWMA/cooldown signals layered on top of this order).
 *
 * @param {object} input
 * @returns {{
 *   route:string,
 *   routeReason:string,
 *   orderReason:string,
 *   providerOrder:string[],
 *   budget:object,
 *   features:object
 * }}
 */
export const resolveAnnAdaptiveStrategy = ({
  mode = 'code',
  queryTokens = [],
  candidatePolicy = null,
  candidateSet = null,
  meta = null,
  searchTopN = 10,
  expandedTopN = 30,
  adaptiveProvidersEnabled = false,
  vectorOnlyProfile = false,
  filtersActive = false,
  providerCount = 0,
  providerOrder = []
} = {}) => {
  const queryClass = resolveQueryClass(queryTokens);
  const candidateSizePolicy = Number.isFinite(Number(candidatePolicy?.candidateSize))
    ? Number(candidatePolicy.candidateSize)
    : null;
  const candidateSize = candidateSizePolicy != null
    ? normalizeNonNegativeInt(candidateSizePolicy)
    : normalizeNonNegativeInt(candidateSet?.size, 0);
  const docCount = Array.isArray(meta)
    ? normalizeNonNegativeInt(meta.length)
    : normalizeNonNegativeInt(candidatePolicy?.inputSize, candidateSize);
  const minTopN = Math.max(1, normalizePositiveInt(searchTopN, 10));
  const maxTopN = Math.max(minTopN, normalizePositiveInt(expandedTopN, minTopN * 3));
  let topN = maxTopN;
  if (candidateSize > 0) {
    const candidateCap = Math.max(minTopN, Math.ceil(candidateSize * 1.25));
    topN = Math.min(topN, candidateCap);
  }
  if (queryClass.symbolHeavy && topN < maxTopN) {
    topN = Math.min(maxTopN, topN + Math.max(2, Math.floor(minTopN / 2)));
  }
  if (mode === 'records') {
    topN = Math.max(minTopN, Math.min(topN, minTopN * 2));
  }
  topN = clampInt(topN, minTopN, maxTopN);
  const efScale = docCount >= 50000 ? 1.5 : (docCount >= 10000 ? 1.25 : 1);
  let hnswEfSearch = Math.round((topN * 4 * efScale) + (queryClass.symbolHeavy ? 16 : 0));
  if (candidateSize > 0) {
    hnswEfSearch = Math.min(hnswEfSearch, Math.max(24, candidateSize * 2));
  }
  hnswEfSearch = clampInt(hnswEfSearch, 24, 512);

  const routeDecision = resolveAdaptiveRoute({
    adaptiveProvidersEnabled,
    vectorOnlyProfile,
    filtersActive,
    providerCount,
    docCount,
    candidateSize,
    queryClass
  });

  const baseOrder = Array.isArray(providerOrder)
    ? providerOrder.filter((backend, index, arr) => arr.indexOf(backend) === index)
    : [];
  const orderHeuristic = adaptiveProvidersEnabled
    ? resolveOrderHeuristic({
      mode,
      candidateSize,
      docCount,
      queryClass
    })
    : {
      reason: ANN_ADAPTIVE_ORDER_REASONS.UNCHANGED,
      order: []
    };
  const reordered = orderHeuristic.reason === ANN_ADAPTIVE_ORDER_REASONS.UNCHANGED
    ? baseOrder
    : reorderWithPreference(baseOrder, orderHeuristic.order);

  return {
    route: routeDecision.route,
    routeReason: routeDecision.reason,
    orderReason: orderHeuristic.reason,
    providerOrder: reordered,
    budget: {
      topN,
      hnswEfSearch,
      providerTopN: {
        [ANN_PROVIDER_IDS.DENSE]: topN,
        [ANN_PROVIDER_IDS.HNSW]: topN,
        [ANN_PROVIDER_IDS.SQLITE_VECTOR]: topN,
        [ANN_PROVIDER_IDS.LANCEDB]: Math.max(topN, Math.min(maxTopN * 2, Math.ceil(topN * 1.25)))
      }
    },
    features: {
      mode,
      docCount,
      candidateSize,
      queryTokenCount: queryClass.tokenCount,
      queryCharCount: queryClass.charCount,
      querySymbolRatio: Number(queryClass.symbolRatio.toFixed(4)),
      querySymbolHeavy: queryClass.symbolHeavy,
      queryShort: queryClass.short,
      filtersActive: filtersActive === true,
      adaptiveProvidersEnabled: adaptiveProvidersEnabled === true,
      providerCount: normalizeNonNegativeInt(providerCount)
    }
  };
};

/**
 * Resolve a safe candidate set shared by ANN and minhash paths.
 * @param {object} input
 * @returns {{
 *   set:Set<number>|null,
 *   reason:string,
 *   explain:object
 * }}
 */
export const resolveAnnCandidateSet = ({
  candidates = null,
  allowedIds = null,
  filtersActive = false,
  cap = 20000,
  minDocCount = 100,
  maxDocCount = 20000,
  toSet = defaultToSet,
  getSize = defaultGetSize,
  hasId = defaultHasId
} = {}) => {
  const resolvedCap = normalizePositiveInt(cap, 20000);
  const resolvedMin = normalizePositiveInt(minDocCount, 100);
  const resolvedMaxRaw = normalizePositiveInt(maxDocCount, 20000);
  const resolvedMax = Math.max(resolvedMin, resolvedMaxRaw);
  const effectiveMax = Math.min(resolvedCap, resolvedMax);

  const candidateSetRaw = toSet(candidates);
  const inputSize = candidateSetRaw ? candidateSetRaw.size : 0;
  const hasAllowedInput = allowedIds != null;
  let allowedSet = allowedIds instanceof Set ? allowedIds : null;
  let allowedSize = allowedSet ? allowedSet.size : null;
  const filtersEnabled = filtersActive === true;

  const resolveAllowedSet = () => {
    if (!hasAllowedInput) return null;
    if (allowedSet instanceof Set) return allowedSet;
    allowedSet = toSet(allowedIds);
    if (allowedSize == null) allowedSize = allowedSet ? allowedSet.size : 0;
    return allowedSet;
  };
  const resolveAllowedSize = () => {
    if (!hasAllowedInput) return 0;
    if (Number.isFinite(allowedSize)) return Math.max(0, Math.floor(allowedSize));
    const resolvedSize = getSize(allowedIds);
    if (Number.isFinite(resolvedSize)) {
      allowedSize = Math.max(0, Math.floor(resolvedSize));
      return allowedSize;
    }
    const resolvedSet = resolveAllowedSet();
    allowedSize = resolvedSet ? resolvedSet.size : 0;
    return allowedSize;
  };
  const hasAllowed = () => resolveAllowedSize() > 0;
  const resolveAllowedFallback = () => {
    if (!filtersEnabled || !hasAllowed()) return null;
    const resolvedSet = resolveAllowedSet();
    return resolvedSet && resolvedSet.size ? resolvedSet : null;
  };

  let candidateSet = candidateSetRaw;
  if (candidateSet && hasAllowedInput) {
    if (allowedSet instanceof Set) {
      candidateSet = intersectSets(candidateSet, allowedSet);
    } else if (typeof hasId === 'function') {
      const filtered = new Set();
      for (const id of candidateSet) {
        if (hasId(allowedIds, id)) filtered.add(id);
      }
      candidateSet = filtered;
    } else {
      const resolvedAllowedSet = resolveAllowedSet();
      if (resolvedAllowedSet) candidateSet = intersectSets(candidateSet, resolvedAllowedSet);
    }
  }
  const candidateSize = candidateSet ? candidateSet.size : 0;

  let reason = ANN_CANDIDATE_POLICY_REASONS.OK;
  let resolvedSet = candidateSet;

  if (!candidateSet || candidateSize === 0) {
    const fallbackSet = resolveAllowedFallback();
    if (fallbackSet) {
      reason = ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
      resolvedSet = fallbackSet;
    } else {
      reason = ANN_CANDIDATE_POLICY_REASONS.NO_CANDIDATES;
      // Under active filters, an explicit empty allowlist means "no docs allowed",
      // not "search the full corpus".
      resolvedSet = filtersEnabled && hasAllowedInput ? new Set() : null;
    }
  } else if (candidateSize > effectiveMax) {
    if (filtersEnabled) {
      // Keep constrained mode under active filters even when candidate volume
      // exceeds cap. Switching to full mode can let out-of-filter ANN hits
      // crowd out required in-filter docs before final filtering.
      reason = ANN_CANDIDATE_POLICY_REASONS.TOO_LARGE;
      resolvedSet = candidateSet;
    } else {
      reason = ANN_CANDIDATE_POLICY_REASONS.TOO_LARGE;
      resolvedSet = null;
    }
  } else if (candidateSize < resolvedMin) {
    const fallbackSet = resolveAllowedFallback();
    if (fallbackSet) {
      reason = ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
      resolvedSet = fallbackSet;
    } else {
      reason = ANN_CANDIDATE_POLICY_REASONS.TOO_SMALL_NO_FILTERS;
      resolvedSet = null;
    }
  }

  const resolvedAllowedSize = hasAllowedInput ? resolveAllowedSize() : 0;
  const hasAllowedResolved = resolvedAllowedSize > 0;

  return {
    set: resolvedSet,
    reason,
    explain: {
      schemaVersion: ANN_CANDIDATE_POLICY_SCHEMA_VERSION,
      reason,
      inputSize,
      candidateSize,
      outputSize: resolvedSet ? resolvedSet.size : null,
      outputMode: resolvedSet ? 'constrained' : 'full',
      filtersActive: filtersEnabled,
      allowedSize: hasAllowedResolved ? resolvedAllowedSize : null,
      cap: resolvedCap,
      minDocCount: resolvedMin,
      maxDocCount: resolvedMax
    }
  };
};
