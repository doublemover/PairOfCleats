export const ANN_CANDIDATE_POLICY_SCHEMA_VERSION = 1;

export const ANN_CANDIDATE_POLICY_REASONS = Object.freeze({
  NO_CANDIDATES: 'noCandidates',
  TOO_LARGE: 'tooLarge',
  TOO_SMALL_NO_FILTERS: 'tooSmallNoFilters',
  FILTERS_ACTIVE_ALLOWED_IDX: 'filtersActiveAllowedIdx',
  OK: 'ok'
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
      resolvedSet = null;
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
