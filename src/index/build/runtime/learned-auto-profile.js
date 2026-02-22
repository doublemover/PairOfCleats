import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';

const AUTO_PROFILE_STATE_FILE = 'learned-auto-profile.json';
const AUTO_PROFILE_SCHEMA_VERSION = '1.0.0';
const AUTO_PROFILE_MAX_TRACKED_PROFILES = 256;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const toPositiveInt = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
};

const toUnitInterval = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
};

const toTimestamp = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveRootIdentity = (root) => {
  const resolved = path.resolve(String(root || '.'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const createDefaultState = () => ({
  schemaVersion: AUTO_PROFILE_SCHEMA_VERSION,
  updatedAt: null,
  profiles: {}
});

const trimProfiles = (profiles, maxEntries = AUTO_PROFILE_MAX_TRACKED_PROFILES) => {
  const entries = Object.entries(profiles || {});
  if (!entries.length) return {};
  if (entries.length <= maxEntries) {
    return Object.fromEntries(entries);
  }
  const ordered = entries
    .sort((a, b) => toTimestamp(b?.[1]?.updatedAt) - toTimestamp(a?.[1]?.updatedAt))
    .slice(0, maxEntries);
  return Object.fromEntries(ordered);
};

const normalizeProfiles = (profiles, maxEntries = AUTO_PROFILE_MAX_TRACKED_PROFILES) => {
  if (!isObject(profiles)) return {};
  const next = {};
  for (const [root, entry] of Object.entries(profiles)) {
    if (!root || !isObject(entry)) continue;
    next[root] = {
      profileId: typeof entry.profileId === 'string' ? entry.profileId : 'balanced',
      confidence: toUnitInterval(entry.confidence, 0),
      reason: typeof entry.reason === 'string' ? entry.reason : 'unknown',
      features: isObject(entry.features) ? entry.features : null,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
      applied: entry.applied === true,
      eligible: entry.eligible === true,
      shadowOnly: entry.shadowOnly === true,
      minConfidence: toUnitInterval(entry.minConfidence, 0.7)
    };
  }
  return trimProfiles(next, maxEntries);
};

const resolveStatePath = (repoCacheRoot) => (
  repoCacheRoot
    ? path.join(repoCacheRoot, 'runtime', AUTO_PROFILE_STATE_FILE)
    : null
);

const resolveAutoProfileConfig = (indexingConfig = {}) => {
  const raw = indexingConfig?.autoProfile && typeof indexingConfig.autoProfile === 'object'
    ? indexingConfig.autoProfile
    : {};
  return {
    enabled: raw.enabled === true,
    shadowOnly: raw.shadowOnly !== false,
    minConfidence: toUnitInterval(raw.minConfidence, 0.7),
    maxScanEntries: toPositiveInt(raw.maxScanEntries, 4000),
    includeDotDirs: raw.includeDotDirs === true,
    maxTrackedProfiles: toPositiveInt(raw.maxTrackedProfiles, AUTO_PROFILE_MAX_TRACKED_PROFILES)
  };
};

const loadAutoProfileState = async (repoCacheRoot, { maxTrackedProfiles = AUTO_PROFILE_MAX_TRACKED_PROFILES } = {}) => {
  const statePath = resolveStatePath(repoCacheRoot);
  if (!statePath) {
    return {
      statePath: null,
      state: createDefaultState(),
      recovered: false
    };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return {
      statePath,
      state: {
        schemaVersion: AUTO_PROFILE_SCHEMA_VERSION,
        updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
        profiles: normalizeProfiles(parsed?.profiles, maxTrackedProfiles)
      },
      recovered: false
    };
  } catch (err) {
    return {
      statePath,
      state: createDefaultState(),
      recovered: err?.code !== 'ENOENT'
    };
  }
};

const saveAutoProfileState = async ({
  statePath,
  state,
  maxTrackedProfiles = AUTO_PROFILE_MAX_TRACKED_PROFILES
}) => {
  if (!statePath || !isObject(state)) return false;
  const payload = {
    schemaVersion: AUTO_PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    profiles: normalizeProfiles(state.profiles, maxTrackedProfiles)
  };
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await atomicWriteJson(statePath, payload, { spaces: 2 });
    return true;
  } catch {
    return false;
  }
};

const shouldSkipEntry = (entry, includeDotDirs) => (
  !entry
  || typeof entry.name !== 'string'
  || (!includeDotDirs && entry.name.startsWith('.'))
);

const sampleRepoFeatures = async (root, { maxEntries = 4000, includeDotDirs = false } = {}) => {
  const stack = [root];
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  let entriesScanned = 0;
  while (stack.length && entriesScanned < maxEntries) {
    const dir = stack.pop();
    let children = [];
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of children) {
      if (entriesScanned >= maxEntries) break;
      if (shouldSkipEntry(entry, includeDotDirs)) continue;
      const abs = path.join(dir, entry.name);
      entriesScanned += 1;
      if (entry.isDirectory()) {
        dirs += 1;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        const stat = await fs.stat(abs);
        const size = Number(stat?.size);
        if (Number.isFinite(size) && size > 0) {
          bytes += size;
        }
      } catch {}
    }
  }
  return {
    files,
    dirs,
    bytes,
    entriesScanned,
    scanTruncated: entriesScanned >= maxEntries
  };
};

const resolveProfileFromFeatures = ({ features, priorProfileId = null }) => {
  const files = Number(features?.files) || 0;
  const bytes = Number(features?.bytes) || 0;
  if (files <= 256 && bytes <= 24 * 1024 * 1024) {
    return {
      profileId: 'latency',
      confidence: 0.86,
      reason: 'tiny-repo-low-fixed-cost',
      overrides: {
        tinyRepoFastPath: {
          enabled: true,
          maxEstimatedLines: 7000,
          maxFiles: 384,
          maxBytes: 24 * 1024 * 1024
        },
        shards: {
          enabled: false
        }
      }
    };
  }
  if (files >= 3000 || bytes >= 300 * 1024 * 1024) {
    return {
      profileId: 'throughput',
      confidence: 0.81,
      reason: 'large-repo-throughput-priority',
      overrides: {
        shards: {
          enabled: true,
          minFiles: 64,
          maxWorkers: 8
        },
        clusterMode: {
          enabled: true,
          workerCount: 8
        }
      }
    };
  }
  const priorConfidenceBoost = priorProfileId === 'balanced' ? 0.08 : 0;
  return {
    profileId: 'balanced',
    confidence: Math.min(0.78, 0.62 + priorConfidenceBoost),
    reason: 'mixed-repo-balanced-defaults',
    overrides: null
  };
};

const resolveFeatureScanFallback = ({ priorProfileId = null, priorConfidence = 0 }) => ({
  profileId: priorProfileId || 'balanced',
  confidence: priorProfileId ? Math.min(0.65, toUnitInterval(priorConfidence, 0.45)) : 0,
  reason: 'feature-scan-fallback',
  overrides: null
});

export const resolveLearnedAutoProfileSelection = async ({
  root,
  repoCacheRoot = null,
  indexingConfig = {},
  log = null
} = {}) => {
  const config = resolveAutoProfileConfig(indexingConfig);
  if (!config.enabled || !root) {
    return {
      enabled: false,
      applied: false,
      eligible: false,
      shadowOnly: config.shadowOnly,
      confidence: 0,
      profileId: 'disabled',
      reason: 'disabled',
      features: null,
      suggestion: null,
      overrides: null,
      state: {
        path: null,
        persisted: false,
        recovered: false
      }
    };
  }
  const rootIdentity = resolveRootIdentity(root);
  const { statePath, state, recovered } = await loadAutoProfileState(repoCacheRoot, {
    maxTrackedProfiles: config.maxTrackedProfiles
  });
  const priorEntry = state?.profiles?.[rootIdentity] && isObject(state.profiles[rootIdentity])
    ? state.profiles[rootIdentity]
    : null;
  const priorProfileId = priorEntry?.profileId || null;
  const priorConfidence = toUnitInterval(priorEntry?.confidence, 0);
  let features = null;
  let featureScanError = null;
  try {
    features = await sampleRepoFeatures(root, {
      maxEntries: config.maxScanEntries,
      includeDotDirs: config.includeDotDirs
    });
  } catch (err) {
    featureScanError = err?.message || String(err);
  }
  const learned = featureScanError
    ? resolveFeatureScanFallback({ priorProfileId, priorConfidence })
    : resolveProfileFromFeatures({ features, priorProfileId });
  const confidence = toUnitInterval(learned.confidence, 0);
  const eligible = confidence >= config.minConfidence;
  const applied = config.shadowOnly !== true && eligible && isObject(learned.overrides);
  state.profiles[rootIdentity] = {
    profileId: learned.profileId,
    confidence,
    reason: learned.reason,
    features,
    updatedAt: new Date().toISOString(),
    applied,
    eligible,
    shadowOnly: config.shadowOnly,
    minConfidence: config.minConfidence
  };
  state.profiles = normalizeProfiles(state.profiles, config.maxTrackedProfiles);
  const persisted = await saveAutoProfileState({
    statePath,
    state,
    maxTrackedProfiles: config.maxTrackedProfiles
  });
  if (typeof log === 'function') {
    const fallbackSuffix = featureScanError ? `, fallback=${featureScanError}` : '';
    log(
      `[auto-profile] learned profile=${learned.profileId} confidence=${confidence.toFixed(2)} ` +
      `(shadowOnly=${config.shadowOnly}, minConfidence=${config.minConfidence.toFixed(2)}, ` +
      `eligible=${eligible}, applied=${applied}, persisted=${persisted}${fallbackSuffix}).`
    );
  }
  return {
    enabled: true,
    applied,
    eligible,
    shadowOnly: config.shadowOnly,
    profileId: learned.profileId,
    confidence,
    minConfidence: config.minConfidence,
    reason: learned.reason,
    features,
    overrides: applied ? learned.overrides : null,
    suggestion: learned.overrides || null,
    fallback: featureScanError
      ? {
        reason: featureScanError,
        priorProfileId
      }
      : null,
    state: {
      path: statePath,
      persisted,
      recovered,
      root: rootIdentity
    }
  };
};

export const learnedAutoProfileInternals = Object.freeze({
  resolveAutoProfileConfig,
  sampleRepoFeatures,
  resolveProfileFromFeatures,
  resolveFeatureScanFallback,
  resolveRootIdentity,
  resolveStatePath,
  loadAutoProfileState,
  saveAutoProfileState,
  normalizeProfiles
});
