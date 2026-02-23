import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const PROFILE_VERSION = 1;
const PROFILE_NAME = 'embeddings-autotune.json';
const MAX_ENTRIES = 64;

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const clampPositiveInt = (value, fallback = null) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const clampUnit = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const resolveProfilePath = (repoCacheRoot) => (
  typeof repoCacheRoot === 'string' && repoCacheRoot.trim()
    ? path.join(repoCacheRoot, 'metrics', PROFILE_NAME)
    : null
);

const buildEntryKey = ({ provider, modelId }) => `${provider || 'unknown'}::${modelId || 'unknown'}`;

const normalizeEntry = (entry) => {
  if (!isObject(entry)) return null;
  const recommended = isObject(entry.recommended) ? entry.recommended : {};
  const batchSize = clampPositiveInt(recommended.batchSize, null);
  const maxBatchTokens = clampPositiveInt(recommended.maxBatchTokens, null);
  const fileParallelism = clampPositiveInt(recommended.fileParallelism, null);
  if (batchSize == null && maxBatchTokens == null && fileParallelism == null) return null;
  return {
    provider: typeof entry.provider === 'string' ? entry.provider : null,
    modelId: typeof entry.modelId === 'string' ? entry.modelId : null,
    sampleCount: clampPositiveInt(entry.sampleCount, 1),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    recommended: {
      ...(batchSize != null ? { batchSize } : {}),
      ...(maxBatchTokens != null ? { maxBatchTokens } : {}),
      ...(fileParallelism != null ? { fileParallelism } : {})
    },
    observed: isObject(entry.observed) ? entry.observed : null
  };
};

const normalizeProfile = (value) => {
  if (!isObject(value) || Number(value.version) !== PROFILE_VERSION) return null;
  const byIdentity = isObject(value.byIdentity) ? value.byIdentity : {};
  const normalizedEntries = [];
  for (const [key, entry] of Object.entries(byIdentity)) {
    const normalized = normalizeEntry(entry);
    if (!normalized) continue;
    normalizedEntries.push([key, normalized]);
  }
  normalizedEntries.sort((left, right) => {
    const leftAt = Date.parse(left[1].updatedAt || '') || 0;
    const rightAt = Date.parse(right[1].updatedAt || '') || 0;
    return rightAt - leftAt;
  });
  const trimmed = normalizedEntries.slice(0, MAX_ENTRIES);
  return {
    version: PROFILE_VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    byIdentity: Object.fromEntries(trimmed)
  };
};

/**
 * Load profile recommendation for one provider/model identity.
 *
 * @param {{repoCacheRoot?:string,provider?:string,modelId?:string,log?:(line:string)=>void}} [input]
 * @returns {object|null}
 */
export const loadEmbeddingsAutoTuneRecommendation = ({
  repoCacheRoot,
  provider,
  modelId,
  log = null
} = {}) => {
  const profilePath = resolveProfilePath(repoCacheRoot);
  if (!profilePath) return null;
  try {
    const raw = fs.readFileSync(profilePath, 'utf8');
    const profile = normalizeProfile(JSON.parse(raw));
    if (!profile) return null;
    const key = buildEntryKey({ provider, modelId });
    return profile.byIdentity?.[key] || null;
  } catch (err) {
    if (err?.code !== 'ENOENT' && typeof log === 'function') {
      log(`[embeddings] failed to load autotune profile: ${err?.message || err}`);
    }
    return null;
  }
};

/**
 * Derive next recommendation using observed throughput/latency.
 *
 * @param {{
 *  observed?:object,
 *  current?:{batchSize?:number,maxBatchTokens?:number,fileParallelism?:number}
 * }} [input]
 * @returns {object|null}
 */
export const deriveEmbeddingsAutoTuneRecommendation = ({
  observed = {},
  current = {}
} = {}) => {
  const currentBatchSize = clampPositiveInt(current.batchSize, null);
  const currentBatchTokens = clampPositiveInt(current.maxBatchTokens, null);
  const currentFileParallelism = clampPositiveInt(current.fileParallelism, null);
  if (currentBatchSize == null && currentBatchTokens == null && currentFileParallelism == null) {
    return null;
  }
  const textsEmbedded = Math.max(0, Number(observed.textsEmbedded) || 0);
  const batches = Math.max(0, Number(observed.batches) || 0);
  const avgBatchMs = batches > 0
    ? Math.max(0, Number(observed.batchComputeMs) || 0) / batches
    : 0;
  const queuePressure = clampUnit(observed.computeQueuePressure, 0);
  const lowReuse = clampUnit(1 - (Number(observed.reuseRate) || 0), 1);
  let nextBatchSize = currentBatchSize;
  if (nextBatchSize != null && textsEmbedded >= 128) {
    if (avgBatchMs > 900) {
      nextBatchSize = Math.max(8, Math.floor(nextBatchSize * 0.85));
    } else if (avgBatchMs > 0 && avgBatchMs < 180 && queuePressure < 0.3) {
      nextBatchSize = Math.min(512, Math.ceil(nextBatchSize * 1.2));
    }
  }
  let nextBatchTokens = currentBatchTokens;
  if (nextBatchTokens != null && nextBatchSize != null) {
    const minTokens = nextBatchSize * 64;
    const preferredTokens = nextBatchSize * 256;
    if (queuePressure > 0.8 && lowReuse > 0.6) {
      nextBatchTokens = Math.max(minTokens, Math.floor(nextBatchTokens * 0.8));
    } else {
      nextBatchTokens = Math.max(minTokens, Math.min(262144, Math.max(nextBatchTokens, preferredTokens)));
    }
  }
  let nextFileParallelism = currentFileParallelism;
  if (nextFileParallelism != null) {
    if (queuePressure > 0.85) {
      nextFileParallelism = Math.max(1, nextFileParallelism - 1);
    } else if (queuePressure < 0.35 && textsEmbedded >= 256) {
      nextFileParallelism = Math.min(32, nextFileParallelism + 1);
    }
  }
  return {
    batchSize: nextBatchSize,
    maxBatchTokens: nextBatchTokens,
    fileParallelism: nextFileParallelism
  };
};

/**
 * Persist one provider/model recommendation entry.
 *
 * @param {{
 *  repoCacheRoot?:string,
 *  provider?:string,
 *  modelId?:string,
 *  recommended?:object,
 *  observed?:object,
 *  log?:(line:string)=>void
 * }} [input]
 * @returns {Promise<object|null>}
 */
export const writeEmbeddingsAutoTuneRecommendation = async ({
  repoCacheRoot,
  provider,
  modelId,
  recommended = {},
  observed = {},
  log = null
} = {}) => {
  const profilePath = resolveProfilePath(repoCacheRoot);
  if (!profilePath) return null;
  const key = buildEntryKey({ provider, modelId });
  let profile = null;
  try {
    const raw = await fsPromises.readFile(profilePath, 'utf8');
    profile = normalizeProfile(JSON.parse(raw));
  } catch (err) {
    if (err?.code !== 'ENOENT' && typeof log === 'function') {
      log(`[embeddings] failed to read autotune profile for update: ${err?.message || err}`);
    }
  }
  if (!profile) {
    profile = {
      version: PROFILE_VERSION,
      updatedAt: null,
      byIdentity: {}
    };
  }
  const now = new Date().toISOString();
  const prior = normalizeEntry(profile.byIdentity[key]) || {
    provider,
    modelId,
    sampleCount: 0,
    updatedAt: null,
    recommended: {},
    observed: null
  };
  const nextRecommended = {
    ...prior.recommended,
    ...recommended
  };
  const normalizedRecommended = {
    ...(clampPositiveInt(nextRecommended.batchSize, null) != null
      ? { batchSize: clampPositiveInt(nextRecommended.batchSize, null) }
      : {}),
    ...(clampPositiveInt(nextRecommended.maxBatchTokens, null) != null
      ? { maxBatchTokens: clampPositiveInt(nextRecommended.maxBatchTokens, null) }
      : {}),
    ...(clampPositiveInt(nextRecommended.fileParallelism, null) != null
      ? { fileParallelism: clampPositiveInt(nextRecommended.fileParallelism, null) }
      : {})
  };
  if (!Object.keys(normalizedRecommended).length) return null;
  profile.byIdentity[key] = {
    provider,
    modelId,
    sampleCount: Math.max(1, (Number(prior.sampleCount) || 0) + 1),
    updatedAt: now,
    recommended: normalizedRecommended,
    observed: isObject(observed) ? observed : null
  };
  profile.updatedAt = now;
  const normalizedProfile = normalizeProfile(profile);
  if (!normalizedProfile) return null;
  try {
    await fsPromises.mkdir(path.dirname(profilePath), { recursive: true });
    await fsPromises.writeFile(profilePath, `${JSON.stringify(normalizedProfile, null, 2)}\n`, 'utf8');
    return normalizedProfile.byIdentity[key] || null;
  } catch (err) {
    if (typeof log === 'function') {
      log(`[embeddings] failed to persist autotune profile: ${err?.message || err}`);
    }
    return null;
  }
};
