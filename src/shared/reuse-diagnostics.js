const normalizeString = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

export const normalizeReuseSurface = (value) => {
  const text = normalizeString(value);
  return text ? text.toLowerCase() : null;
};

export const normalizeReuseSource = (value) => {
  const text = normalizeString(value);
  return text ? text.toLowerCase() : null;
};

export const toNonNegativeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.max(0, Math.floor(parsed)) : null;
};

export const resolveScmFallbackCause = ({
  source,
  timeoutCount = 0,
  cooldownSkips = 0,
  unavailableChunks = 0
}) => {
  const normalizedSource = normalizeReuseSource(source) || 'unknown';
  if (normalizedSource === 'cache') return 'cache_hit';
  if (normalizedSource === 'fresh') return 'cache_miss';
  if (normalizedSource === 'mixed') return 'scm_state_prevents_reuse';
  if (normalizedSource.includes('fallback')) {
    if ((Number(timeoutCount) || 0) > 0 || (Number(cooldownSkips) || 0) > 0 || (Number(unavailableChunks) || 0) > 0) {
      return 'provider_unhealthy';
    }
    return 'provider_unavailable';
  }
  return 'unknown';
};

export const resolveQualityImpactForCause = (causeClass) => {
  switch (String(causeClass || '').trim().toLowerCase()) {
    case 'provider_unhealthy':
    case 'provider_unavailable':
    case 'workspace_blocked':
      return 'partial-provider-fidelity';
    case 'cache_write_failed':
      return 'future-reuse-risk';
    case 'cache_invalid':
    case 'cache_miss':
    case 'scm_state_prevents_reuse':
    case 'cache_hit':
    default:
      return 'none';
  }
};

const bumpMapCount = (map, key, count = 1) => {
  if (!(map instanceof Map)) return;
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) return;
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + count);
};

const sortMapObject = (map) => Object.fromEntries(
  Array.from((map instanceof Map ? map : new Map()).entries())
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
);

const mergeGenerationIdentity = (target, source) => {
  if (!source || typeof source !== 'object') return target;
  const next = target && typeof target === 'object'
    ? { ...target }
    : {
      mode: null,
      repoRoot: null,
      buildRoot: null,
      buildId: null
    };
  if (!next.mode && normalizeString(source.mode)) next.mode = normalizeString(source.mode);
  if (!next.repoRoot && normalizeString(source.repoRoot)) next.repoRoot = normalizeString(source.repoRoot);
  if (!next.buildRoot && normalizeString(source.buildRoot)) next.buildRoot = normalizeString(source.buildRoot);
  if (!next.buildId && normalizeString(source.buildId)) next.buildId = normalizeString(source.buildId);
  return next;
};

export const normalizeReuseObservation = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const reuseSurface = normalizeReuseSurface(entry.reuseSurface);
  const reuseSource = normalizeReuseSource(entry.reuseSource);
  const causeClass = normalizeString(entry.causeClass);
  const qualityImpact = normalizeString(entry.qualityImpact);
  if (!reuseSurface && !reuseSource && !causeClass && !qualityImpact) return null;
  return {
    kind: normalizeString(entry.kind),
    providerId: normalizeString(entry.providerId),
    reuseSurface,
    reuseSource,
    causeClass,
    qualityImpact,
    requestedCount: toNonNegativeCount(entry.requestedCount),
    reusedCount: toNonNegativeCount(entry.reusedCount),
    fetchedCount: toNonNegativeCount(entry.fetchedCount),
    chunkCount: toNonNegativeCount(entry.chunkCount),
    timeCostMs: toNonNegativeCount(entry.timeCostMs),
    generation: mergeGenerationIdentity(null, entry.generation)
  };
};

export const summarizeReuseObservations = (observations = [], { generation = null } = {}) => {
  const normalized = [];
  const countsByCause = new Map();
  const countsBySurface = new Map();
  const countsBySurfaceAndSource = new Map();
  const countsByQualityImpact = new Map();
  const scmSnapshotSources = new Map();
  const providerResultSources = new Map();
  let timeCostMs = 0;
  let requestedCount = 0;
  let reusedCount = 0;
  let fetchedCount = 0;
  let chunkCount = 0;
  let generationIdentity = mergeGenerationIdentity({
    mode: null,
    repoRoot: null,
    buildRoot: null,
    buildId: null
  }, generation);

  for (const entry of Array.isArray(observations) ? observations : []) {
    const normalizedEntry = normalizeReuseObservation(entry);
    if (!normalizedEntry) continue;
    normalized.push(normalizedEntry);
    generationIdentity = mergeGenerationIdentity(generationIdentity, normalizedEntry.generation);
    bumpMapCount(countsByCause, normalizedEntry.causeClass);
    bumpMapCount(countsBySurface, normalizedEntry.reuseSurface);
    if (normalizedEntry.reuseSurface && normalizedEntry.reuseSource) {
      bumpMapCount(countsBySurfaceAndSource, `${normalizedEntry.reuseSurface}:${normalizedEntry.reuseSource}`);
    }
    bumpMapCount(countsByQualityImpact, normalizedEntry.qualityImpact);
    if (normalizedEntry.kind === 'scm_snapshot' && normalizedEntry.reuseSource) {
      bumpMapCount(scmSnapshotSources, normalizedEntry.reuseSource);
    }
    if (
      (normalizedEntry.kind === 'provider_result' || normalizedEntry.kind === 'provider_cache')
      && normalizedEntry.reuseSource
    ) {
      bumpMapCount(providerResultSources, normalizedEntry.reuseSource);
    }
    timeCostMs += Number(normalizedEntry.timeCostMs) || 0;
    requestedCount += Number(normalizedEntry.requestedCount) || 0;
    reusedCount += Number(normalizedEntry.reusedCount) || 0;
    fetchedCount += Number(normalizedEntry.fetchedCount) || 0;
    chunkCount += Number(normalizedEntry.chunkCount) || 0;
  }

  return {
    observationCount: normalized.length,
    generationAware: Boolean(generationIdentity?.buildRoot || generationIdentity?.buildId),
    generation: generationIdentity,
    countsByCause: sortMapObject(countsByCause),
    countsBySurface: sortMapObject(countsBySurface),
    countsBySurfaceAndSource: sortMapObject(countsBySurfaceAndSource),
    countsByQualityImpact: sortMapObject(countsByQualityImpact),
    scmSnapshotSources: sortMapObject(scmSnapshotSources),
    providerResultSources: sortMapObject(providerResultSources),
    cost: {
      timeCostMs,
      requestedCount,
      reusedCount,
      fetchedCount,
      chunkCount
    }
  };
};

export const mergeReuseSummaries = (...summaries) => {
  const observations = [];
  let generation = null;
  for (const summary of summaries) {
    if (!summary || typeof summary !== 'object') continue;
    generation = mergeGenerationIdentity(generation, summary.generation);
    const summaryObservations = Array.isArray(summary.observations) ? summary.observations : [];
    observations.push(...summaryObservations);
  }
  const merged = summarizeReuseObservations(observations, { generation });
  return {
    ...merged,
    observations
  };
};
