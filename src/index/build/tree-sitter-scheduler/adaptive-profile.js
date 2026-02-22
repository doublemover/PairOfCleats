import fs from 'node:fs/promises';
import path from 'node:path';
import { compareStrings } from '../../../shared/sort.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';

const PROFILE_SCHEMA_VERSION = '1.0.0';
const PROFILE_FILE_NAME = 'adaptive-rows-per-sec.json';
const EMA_ALPHA = 0.35;
const TAIL_EMA_ALPHA = 0.2;
const LANE_COOLDOWN_STEPS_DEFAULT = 3;
const BUCKET_COUNT_PATTERN = /~b\d+of(\d+)/i;

const normalizePositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeRowsPerSec = (value) => normalizePositiveNumber(value);

const normalizeSampleCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

const normalizeLaneState = (value) => {
  if (!value || typeof value !== 'object') return null;
  const bucketCount = Math.max(1, Math.floor(Number(value.bucketCount) || 0));
  if (!bucketCount) return null;
  const cooldownSteps = Math.max(0, Math.floor(Number(value.cooldownSteps) || 0));
  const lastAction = value.lastAction === 'split' || value.lastAction === 'merge'
    ? value.lastAction
    : 'hold';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
  return {
    bucketCount,
    cooldownSteps,
    lastAction,
    updatedAt
  };
};

const parseBucketCountFromGrammarKey = (grammarKey) => {
  if (typeof grammarKey !== 'string' || !grammarKey) return null;
  const match = grammarKey.match(BUCKET_COUNT_PATTERN);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
};

const mergeEma = (prior, observed, alpha = EMA_ALPHA) => {
  const priorValue = normalizePositiveNumber(prior);
  const observedValue = normalizePositiveNumber(observed);
  if (!observedValue) return priorValue;
  if (!priorValue) return observedValue;
  return (priorValue * (1 - alpha)) + (observedValue * alpha);
};

const mergeTailEma = (prior, observed) => {
  const priorValue = normalizePositiveNumber(prior);
  const observedValue = normalizePositiveNumber(observed);
  if (!observedValue) return priorValue;
  if (!priorValue) return observedValue;
  // Keep tail memory sticky while still decaying over time.
  return Math.max(observedValue, (priorValue * (1 - TAIL_EMA_ALPHA)) + (observedValue * TAIL_EMA_ALPHA));
};

const resolveObservedBucketCount = (sample) => {
  const explicit = Math.max(0, Math.floor(Number(sample?.bucketCount) || 0));
  if (explicit > 0) return explicit;
  return parseBucketCountFromGrammarKey(sample?.grammarKey);
};

const mergeLaneState = (priorState, observedBucketCount, at) => {
  const prior = normalizeLaneState(priorState);
  if (!prior && !observedBucketCount) return null;
  const next = prior
    ? {
      bucketCount: prior.bucketCount,
      cooldownSteps: Math.max(0, prior.cooldownSteps - 1),
      lastAction: prior.lastAction,
      updatedAt: prior.updatedAt
    }
    : {
      bucketCount: Math.max(1, observedBucketCount),
      cooldownSteps: 0,
      lastAction: 'hold',
      updatedAt: null
    };
  const observed = Math.max(0, Math.floor(Number(observedBucketCount) || 0));
  if (observed > 0) {
    if (next.bucketCount > 0) {
      if (observed > next.bucketCount) {
        next.lastAction = 'split';
        next.cooldownSteps = Math.max(next.cooldownSteps, LANE_COOLDOWN_STEPS_DEFAULT);
      } else if (observed < next.bucketCount) {
        next.lastAction = 'merge';
        next.cooldownSteps = Math.max(next.cooldownSteps, LANE_COOLDOWN_STEPS_DEFAULT);
      } else {
        next.lastAction = 'hold';
      }
    }
    next.bucketCount = observed;
  }
  if (typeof at === 'string' && at) {
    next.updatedAt = at;
  }
  return normalizeLaneState(next);
};

export const resolveTreeSitterSchedulerAdaptiveProfilePath = ({ runtime, treeSitterConfig }) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const configuredRoot = typeof schedulerConfig.adaptiveProfileDir === 'string'
    ? schedulerConfig.adaptiveProfileDir.trim()
    : '';
  if (configuredRoot) {
    return path.join(path.resolve(configuredRoot), PROFILE_FILE_NAME);
  }
  if (runtime?.repoCacheRoot) {
    return path.join(runtime.repoCacheRoot, 'tree-sitter-scheduler', PROFILE_FILE_NAME);
  }
  return null;
};

const toSerializableEntries = (entriesByGrammarKey) => {
  const out = {};
  const keys = Array.from(entriesByGrammarKey.keys()).sort(compareStrings);
  for (const grammarKey of keys) {
    const entry = entriesByGrammarKey.get(grammarKey);
    const rowsPerSec = normalizeRowsPerSec(entry?.rowsPerSec);
    if (!rowsPerSec) continue;
    const laneState = normalizeLaneState(entry?.laneState);
    out[grammarKey] = {
      rowsPerSec,
      costPerSec: normalizePositiveNumber(entry?.costPerSec),
      msPerRow: normalizePositiveNumber(entry?.msPerRow),
      tailMsPerRow: normalizePositiveNumber(entry?.tailMsPerRow),
      tailDurationMs: normalizePositiveNumber(entry?.tailDurationMs),
      imbalanceEma: normalizePositiveNumber(entry?.imbalanceEma),
      laneState,
      samples: normalizeSampleCount(entry?.samples),
      updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : null
    };
  }
  return out;
};

const fromSerializableEntries = (entries) => {
  const map = new Map();
  if (!entries || typeof entries !== 'object') return map;
  for (const [grammarKey, rawEntry] of Object.entries(entries)) {
    if (typeof grammarKey !== 'string' || !grammarKey) continue;
    const rowsPerSec = normalizeRowsPerSec(rawEntry?.rowsPerSec);
    if (!rowsPerSec) continue;
    map.set(grammarKey, {
      rowsPerSec,
      costPerSec: normalizePositiveNumber(rawEntry?.costPerSec),
      msPerRow: normalizePositiveNumber(rawEntry?.msPerRow),
      tailMsPerRow: normalizePositiveNumber(rawEntry?.tailMsPerRow),
      tailDurationMs: normalizePositiveNumber(rawEntry?.tailDurationMs),
      imbalanceEma: normalizePositiveNumber(rawEntry?.imbalanceEma),
      laneState: normalizeLaneState(rawEntry?.laneState),
      samples: normalizeSampleCount(rawEntry?.samples),
      updatedAt: typeof rawEntry?.updatedAt === 'string' ? rawEntry.updatedAt : null
    });
  }
  return map;
};

export const loadTreeSitterSchedulerAdaptiveProfile = async ({
  runtime,
  treeSitterConfig,
  log = null
}) => {
  const profilePath = resolveTreeSitterSchedulerAdaptiveProfilePath({ runtime, treeSitterConfig });
  if (!profilePath) {
    return { profilePath: null, entriesByGrammarKey: new Map() };
  }
  try {
    const raw = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
    const entriesByGrammarKey = fromSerializableEntries(fields?.entriesByGrammarKey || {});
    return { profilePath, entriesByGrammarKey };
  } catch (err) {
    if (err?.code !== 'ENOENT' && typeof log === 'function') {
      log(`[tree-sitter:schedule] adaptive profile load failed: ${err?.message || err}`);
    }
    return { profilePath, entriesByGrammarKey: new Map() };
  }
};

/**
 * Merge observed throughput samples into an adaptive rows/sec profile.
 * Uses EMA smoothing so short-lived machine jitter does not whipsaw bucket sizes.
 *
 * @param {Map<string,object>} existing
 * @param {Array<{baseGrammarKey:string,grammarKey?:string,rows:number,durationMs:number,estimatedParseCost?:number,bucketCount?:number,laneImbalanceRatio?:number,at?:string}>} samples
 * @returns {Map<string,object>}
 */
export const mergeTreeSitterSchedulerAdaptiveProfile = (existing, samples = []) => {
  const next = new Map(existing instanceof Map ? existing : []);
  for (const sample of samples) {
    const baseGrammarKey = typeof sample?.baseGrammarKey === 'string' ? sample.baseGrammarKey : null;
    const rows = Number(sample?.rows);
    const durationMs = Number(sample?.durationMs);
    if (!baseGrammarKey || !Number.isFinite(rows) || rows <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
      continue;
    }
    const observedRowsPerSec = rows / Math.max(0.001, (durationMs / 1000));
    if (!Number.isFinite(observedRowsPerSec) || observedRowsPerSec <= 0) continue;
    const observedMsPerRow = durationMs / Math.max(1, rows);
    const observedEstimatedParseCost = normalizePositiveNumber(sample?.estimatedParseCost);
    const observedCostPerSec = observedEstimatedParseCost
      ? (observedEstimatedParseCost / Math.max(0.001, (durationMs / 1000)))
      : null;
    const observedLaneImbalance = normalizePositiveNumber(sample?.laneImbalanceRatio);
    const observedBucketCount = resolveObservedBucketCount(sample);
    const observedAt = typeof sample?.at === 'string' ? sample.at : new Date().toISOString();
    const prior = next.get(baseGrammarKey);
    const mergedRowsPerSec = mergeEma(prior?.rowsPerSec, observedRowsPerSec, EMA_ALPHA);
    const mergedCostPerSec = observedCostPerSec
      ? mergeEma(prior?.costPerSec, observedCostPerSec, EMA_ALPHA)
      : normalizePositiveNumber(prior?.costPerSec);
    const mergedMsPerRow = mergeEma(prior?.msPerRow, observedMsPerRow, EMA_ALPHA);
    const mergedTailMsPerRow = mergeTailEma(prior?.tailMsPerRow, observedMsPerRow);
    const mergedTailDurationMs = mergeTailEma(prior?.tailDurationMs, durationMs);
    const mergedImbalanceEma = observedLaneImbalance
      ? mergeEma(prior?.imbalanceEma, observedLaneImbalance, EMA_ALPHA)
      : normalizePositiveNumber(prior?.imbalanceEma);
    const laneState = mergeLaneState(prior?.laneState, observedBucketCount, observedAt);
    next.set(baseGrammarKey, {
      rowsPerSec: mergedRowsPerSec,
      costPerSec: mergedCostPerSec,
      msPerRow: mergedMsPerRow,
      tailMsPerRow: mergedTailMsPerRow,
      tailDurationMs: mergedTailDurationMs,
      imbalanceEma: mergedImbalanceEma,
      laneState,
      samples: normalizeSampleCount(prior?.samples) + 1,
      updatedAt: observedAt
    });
  }
  return next;
};

export const saveTreeSitterSchedulerAdaptiveProfile = async ({
  profilePath,
  entriesByGrammarKey,
  log = null
}) => {
  if (!profilePath) return;
  const payload = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entriesByGrammarKey: toSerializableEntries(entriesByGrammarKey)
  };
  try {
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await writeJsonObjectFile(profilePath, { fields: payload, atomic: true });
  } catch (err) {
    if (typeof log === 'function') {
      log(`[tree-sitter:schedule] adaptive profile save failed: ${err?.message || err}`);
    }
  }
};
