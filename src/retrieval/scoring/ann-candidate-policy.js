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
  toSet = defaultToSet
} = {}) => {
  const resolvedCap = normalizePositiveInt(cap, 20000);
  const resolvedMin = normalizePositiveInt(minDocCount, 100);
  const resolvedMaxRaw = normalizePositiveInt(maxDocCount, 20000);
  const resolvedMax = Math.max(resolvedMin, resolvedMaxRaw);
  const effectiveMax = Math.min(resolvedCap, resolvedMax);

  const allowedSet = toSet(allowedIds);
  const candidateSetRaw = toSet(candidates);
  const inputSize = candidateSetRaw ? candidateSetRaw.size : 0;
  const allowedSize = allowedSet ? allowedSet.size : 0;
  const hasAllowed = allowedSize > 0;
  const filtersEnabled = filtersActive === true;

  let candidateSet = candidateSetRaw;
  if (candidateSet && allowedSet) {
    candidateSet = intersectSets(candidateSet, allowedSet);
  }
  const candidateSize = candidateSet ? candidateSet.size : 0;

  let reason = ANN_CANDIDATE_POLICY_REASONS.OK;
  let resolvedSet = candidateSet;

  if (!candidateSet || candidateSize === 0) {
    if (filtersEnabled && hasAllowed) {
      reason = ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
      resolvedSet = allowedSet;
    } else {
      reason = ANN_CANDIDATE_POLICY_REASONS.NO_CANDIDATES;
      resolvedSet = null;
    }
  } else if (candidateSize > effectiveMax) {
    reason = ANN_CANDIDATE_POLICY_REASONS.TOO_LARGE;
    resolvedSet = null;
  } else if (candidateSize < resolvedMin) {
    if (filtersEnabled && hasAllowed) {
      reason = ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
      resolvedSet = allowedSet;
    } else {
      reason = ANN_CANDIDATE_POLICY_REASONS.TOO_SMALL_NO_FILTERS;
      resolvedSet = null;
    }
  }

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
      allowedSize: hasAllowed ? allowedSize : null,
      cap: resolvedCap,
      minDocCount: resolvedMin,
      maxDocCount: resolvedMax
    }
  };
};
