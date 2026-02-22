import fs from 'node:fs/promises';
import path from 'node:path';
import { compareStrings } from '../../../shared/sort.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';

const PROFILE_SCHEMA_VERSION = '1.0.0';
const PROFILE_FILE_NAME = 'adaptive-rows-per-sec.json';
const EMA_ALPHA = 0.35;

const normalizeRowsPerSec = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeSampleCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
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
    out[grammarKey] = {
      rowsPerSec,
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
 * @param {Map<string,{rowsPerSec:number,samples:number,updatedAt:string|null}>} existing
 * @param {Array<{baseGrammarKey:string,rows:number,durationMs:number,at?:string}>} samples
 * @returns {Map<string,{rowsPerSec:number,samples:number,updatedAt:string|null}>}
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
    const prior = next.get(baseGrammarKey);
    const priorRowsPerSec = normalizeRowsPerSec(prior?.rowsPerSec);
    const mergedRowsPerSec = priorRowsPerSec
      ? ((priorRowsPerSec * (1 - EMA_ALPHA)) + (observedRowsPerSec * EMA_ALPHA))
      : observedRowsPerSec;
    next.set(baseGrammarKey, {
      rowsPerSec: mergedRowsPerSec,
      samples: normalizeSampleCount(prior?.samples) + 1,
      updatedAt: typeof sample?.at === 'string' ? sample.at : new Date().toISOString()
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
