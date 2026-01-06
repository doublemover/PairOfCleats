import fs from 'node:fs/promises';
import path from 'node:path';

const PERF_PROFILE_VERSION = 1;
const DEFAULT_BUCKETS = [
  { id: 'xs', maxBytes: 8 * 1024 },
  { id: 's', maxBytes: 32 * 1024 },
  { id: 'm', maxBytes: 128 * 1024 },
  { id: 'l', maxBytes: 512 * 1024 },
  { id: 'xl', maxBytes: 1024 * 1024 },
  { id: 'xxl', maxBytes: null }
];

const normalizeBucketId = (value, fallback) => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const resolveBucket = (bytes, buckets) => {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  for (const bucket of buckets) {
    if (bucket.maxBytes == null || size <= bucket.maxBytes) return bucket;
  }
  return buckets[buckets.length - 1];
};

const initTotals = () => ({
  files: 0,
  bytes: 0,
  lines: 0,
  durationMs: 0,
  parseMs: 0,
  tokenizeMs: 0,
  enrichMs: 0,
  embeddingMs: 0
});

const addTotals = (totals, metric) => {
  totals.files += 1;
  totals.bytes += metric.bytes || 0;
  totals.lines += metric.lines || 0;
  totals.durationMs += metric.durationMs || 0;
  totals.parseMs += metric.parseMs || 0;
  totals.tokenizeMs += metric.tokenizeMs || 0;
  totals.enrichMs += metric.enrichMs || 0;
  totals.embeddingMs += metric.embeddingMs || 0;
};

const finalizeTotals = (totals) => {
  const files = totals.files || 0;
  const bytes = totals.bytes || 0;
  const lines = totals.lines || 0;
  const durationMs = totals.durationMs || 0;
  return {
    ...totals,
    avgMsPerFile: files ? durationMs / files : 0,
    byteCostMs: bytes ? durationMs / bytes : 0,
    lineCostMs: lines ? durationMs / lines : 0,
    bytesPerMs: durationMs ? bytes / durationMs : 0,
    linesPerMs: durationMs ? lines / durationMs : 0
  };
};

export function createPerfProfile({
  configHash,
  mode,
  buildId = null,
  buckets = DEFAULT_BUCKETS,
  features = null
} = {}) {
  return {
    version: PERF_PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    configHash: configHash || null,
    mode: mode || null,
    buildId,
    buckets: buckets.map((bucket) => ({
      id: normalizeBucketId(bucket.id, 'bucket'),
      maxBytes: bucket.maxBytes ?? null
    })),
    features: features && typeof features === 'object' ? features : null,
    totals: initTotals(),
    languages: {}
  };
}

export function recordFileMetric(profile, metric) {
  if (!profile || !metric || metric.cached) return;
  const languageId = typeof metric.languageId === 'string' && metric.languageId
    ? metric.languageId
    : 'unknown';
  const buckets = Array.isArray(profile.buckets) && profile.buckets.length
    ? profile.buckets
    : DEFAULT_BUCKETS;
  const bucket = resolveBucket(metric.bytes, buckets);
  const langEntry = profile.languages[languageId] || {
    totals: initTotals(),
    buckets: {}
  };
  const bucketEntry = langEntry.buckets[bucket.id] || initTotals();
  addTotals(langEntry.totals, metric);
  addTotals(profile.totals, metric);
  addTotals(bucketEntry, metric);
  langEntry.buckets[bucket.id] = bucketEntry;
  profile.languages[languageId] = langEntry;
}

export function finalizePerfProfile(profile) {
  if (!profile) return null;
  profile.totals = finalizeTotals(profile.totals || initTotals());
  for (const entry of Object.values(profile.languages || {})) {
    entry.totals = finalizeTotals(entry.totals || initTotals());
    for (const [bucketId, bucketTotals] of Object.entries(entry.buckets || {})) {
      entry.buckets[bucketId] = finalizeTotals(bucketTotals);
    }
  }
  return profile;
}

export async function loadPerfProfile({ metricsDir, mode, configHash, log }) {
  if (!metricsDir) return null;
  const fileName = mode ? `perf-profile-${mode}.json` : 'perf-profile.json';
  const filePath = path.join(metricsDir, fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== PERF_PROFILE_VERSION) return null;
    if (configHash && parsed.configHash && parsed.configHash !== configHash) {
      if (log) log(`[shards] Perf profile config hash mismatch; ignoring.`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function estimateFileCost({
  perfProfile,
  languageId,
  bytes = 0,
  lines = 0,
  featureWeights = null
} = {}) {
  const profile = perfProfile || null;
  const buckets = Array.isArray(profile?.buckets) && profile.buckets.length
    ? profile.buckets
    : DEFAULT_BUCKETS;
  const langKey = typeof languageId === 'string' && languageId ? languageId : 'unknown';
  const langProfile = profile?.languages?.[langKey] || profile?.languages?.unknown || null;
  const bucket = resolveBucket(bytes, buckets);
  const bucketProfile = langProfile?.buckets?.[bucket.id] || null;
  const fallback = langProfile?.totals || profile?.totals || initTotals();
  const resolved = bucketProfile || fallback;
  const overhead = resolved.avgMsPerFile || fallback.avgMsPerFile || 0;
  const byteCost = resolved.byteCostMs || fallback.byteCostMs || 0;
  const lineCost = resolved.lineCostMs || fallback.lineCostMs || 0;
  const baseCost = overhead + (byteCost * bytes) + (lineCost * lines);
  if (!featureWeights || typeof featureWeights !== 'object') return baseCost;
  let multiplier = 1;
  for (const value of Object.values(featureWeights)) {
    if (typeof value === 'number') multiplier += value;
  }
  return baseCost * multiplier;
}

