import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

const FEATURE_METRICS_VERSION = 1;

const initBucket = () => ({
  count: 0,
  lines: 0,
  bytes: 0,
  durationMs: 0
});

const addBucket = (bucket, delta) => {
  if (!bucket || !delta) return;
  const count = Number(delta.count) || 0;
  const lines = Number(delta.lines) || 0;
  const bytes = Number(delta.bytes) || 0;
  const durationMs = Number(delta.durationMs) || 0;
  bucket.count += count;
  bucket.lines += lines;
  bucket.bytes += bytes;
  bucket.durationMs += durationMs;
};

const finalizeBucket = (bucket) => {
  if (!bucket) return null;
  const count = Number(bucket.count) || 0;
  const lines = Number(bucket.lines) || 0;
  const durationMs = Number(bucket.durationMs) || 0;
  bucket.msPerLine = lines > 0 ? durationMs / lines : 0;
  bucket.linesPerMs = durationMs > 0 ? lines / durationMs : 0;
  bucket.msPerCount = count > 0 ? durationMs / count : 0;
  bucket.linesPerCount = count > 0 ? lines / count : 0;
  return bucket;
};

const ensureMode = (state, mode) => {
  const key = mode || 'unknown';
  if (!state.modes[key]) {
    state.modes[key] = {
      totals: initBucket(),
      languages: {},
      languageSets: {},
      settings: {}
    };
  }
  return state.modes[key];
};

const ensureNamedBucket = (collection, key) => {
  const name = key || 'unknown';
  if (!collection[name]) collection[name] = initBucket();
  return collection[name];
};

const ensureSetting = (modeEntry, setting, enabled = null) => {
  const key = setting || 'unknown';
  if (!modeEntry.settings[key]) {
    modeEntry.settings[key] = {
      enabled: enabled === null ? null : Boolean(enabled),
      enabledRuns: 0,
      totals: initBucket(),
      languages: {},
      languageSets: {}
    };
  } else if (enabled !== null && typeof enabled === 'boolean') {
    modeEntry.settings[key].enabled = enabled;
  }
  return modeEntry.settings[key];
};

export function createFeatureMetrics({
  buildId = null,
  configHash = null,
  stage = null,
  repoRoot = null,
  toolVersion = null
} = {}) {
  const state = {
    version: FEATURE_METRICS_VERSION,
    generatedAt: new Date().toISOString(),
    buildId,
    configHash,
    stage,
    repoRoot,
    toolVersion,
    modes: {}
  };

  const registerSettings = (mode, settings = {}) => {
    const modeEntry = ensureMode(state, mode);
    for (const [setting, enabled] of Object.entries(settings || {})) {
      ensureSetting(modeEntry, setting, Boolean(enabled));
    }
  };

  const recordFile = ({
    mode,
    languageSet,
    languageLines,
    lines,
    bytes,
    durationMs
  }) => {
    const modeEntry = ensureMode(state, mode);
    addBucket(modeEntry.totals, { count: 1, lines, bytes, durationMs });
    if (languageSet) {
      const setBucket = ensureNamedBucket(modeEntry.languageSets, languageSet);
      addBucket(setBucket, { count: 1, lines, bytes, durationMs });
    }
    const totalLines = Number(lines) || 0;
    const entries = languageLines instanceof Map
      ? Array.from(languageLines.entries())
      : Object.entries(languageLines || {});
    if (!entries.length) return;
    const fallbackTotal = entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
    const lineTotal = totalLines > 0 ? totalLines : fallbackTotal;
    for (const [languageId, languageLineCount] of entries) {
      const langLines = Number(languageLineCount) || 0;
      if (!langLines) continue;
      const share = lineTotal > 0 ? langLines / lineTotal : 0;
      const langBucket = ensureNamedBucket(modeEntry.languages, languageId);
      addBucket(langBucket, {
        count: 1,
        lines: langLines,
        bytes: share > 0 ? (Number(bytes) || 0) * share : 0,
        durationMs: share > 0 ? (Number(durationMs) || 0) * share : 0
      });
    }
  };

  const recordSetting = ({
    mode,
    setting,
    enabled = null,
    languageId,
    languageSet,
    lines,
    bytes,
    durationMs,
    count = 1
  }) => {
    const modeEntry = ensureMode(state, mode);
    const settingEntry = ensureSetting(modeEntry, setting, enabled);
    addBucket(settingEntry.totals, { count, lines, bytes, durationMs });
    if (languageId) {
      const langBucket = ensureNamedBucket(settingEntry.languages, languageId);
      addBucket(langBucket, { count, lines, bytes, durationMs });
    }
    if (languageSet) {
      const setBucket = ensureNamedBucket(settingEntry.languageSets, languageSet);
      addBucket(setBucket, { count, lines, bytes, durationMs });
    }
  };

  const recordSettingByLanguageShare = ({
    mode,
    setting,
    enabled = null,
    durationMs,
    count = 1
  }) => {
    const modeEntry = ensureMode(state, mode);
    const languageEntries = Object.entries(modeEntry.languages || {});
    const totalLines = languageEntries.reduce((sum, [, bucket]) => (
      sum + (Number(bucket?.lines) || 0)
    ), 0);
    if (!totalLines) return;
    for (const [languageId, bucket] of languageEntries) {
      const lines = Number(bucket?.lines) || 0;
      if (!lines) continue;
      const share = lines / totalLines;
      const shareDuration = (Number(durationMs) || 0) * share;
      recordSetting({
        mode,
        setting,
        enabled,
        languageId,
        lines,
        durationMs: shareDuration,
        count
      });
    }
  };

  const finalize = () => finalizeFeatureMetrics(state);

  return {
    state,
    registerSettings,
    recordFile,
    recordSetting,
    recordSettingByLanguageShare,
    finalize
  };
}

export function finalizeFeatureMetrics(state) {
  if (!state || typeof state !== 'object') return null;
  state.generatedAt = new Date().toISOString();
  for (const modeEntry of Object.values(state.modes || {})) {
    finalizeBucket(modeEntry.totals);
    for (const langBucket of Object.values(modeEntry.languages || {})) {
      finalizeBucket(langBucket);
    }
    for (const setBucket of Object.values(modeEntry.languageSets || {})) {
      finalizeBucket(setBucket);
    }
    for (const settingEntry of Object.values(modeEntry.settings || {})) {
      finalizeBucket(settingEntry.totals);
      for (const langBucket of Object.values(settingEntry.languages || {})) {
        finalizeBucket(langBucket);
      }
      for (const setBucket of Object.values(settingEntry.languageSets || {})) {
        finalizeBucket(setBucket);
      }
    }
  }
  return state;
}

const mergeBucket = (target, source) => {
  if (!target || !source) return;
  addBucket(target, {
    count: source.count,
    lines: source.lines,
    bytes: source.bytes,
    durationMs: source.durationMs
  });
};

const mergeNamedBuckets = (target, source) => {
  for (const [key, bucket] of Object.entries(source || {})) {
    const targetBucket = ensureNamedBucket(target, key);
    mergeBucket(targetBucket, bucket);
  }
};

export function mergeFeatureMetrics(base, next) {
  if (!next || typeof next !== 'object') return base || null;
  if (!base || typeof base !== 'object') {
    const seeded = JSON.parse(JSON.stringify(next));
    seeded.runs = 1;
    seeded.firstRunAt = next.generatedAt || seeded.generatedAt || null;
    seeded.lastRunAt = next.generatedAt || seeded.generatedAt || null;
    seeded.lastBuildId = next.buildId || null;
    return finalizeFeatureMetrics(seeded);
  }
  const merged = JSON.parse(JSON.stringify(base));
  merged.runs = Number(merged.runs) || 0;
  merged.runs += 1;
  merged.firstRunAt = merged.firstRunAt || merged.generatedAt || null;
  merged.lastRunAt = next.generatedAt || new Date().toISOString();
  merged.lastBuildId = next.buildId || merged.lastBuildId || null;
  merged.version = FEATURE_METRICS_VERSION;
  merged.repoRoot = merged.repoRoot || next.repoRoot || null;
  merged.toolVersion = merged.toolVersion || next.toolVersion || null;
  merged.configHash = merged.configHash || next.configHash || null;
  for (const [mode, modeEntry] of Object.entries(next.modes || {})) {
    const mergedMode = ensureMode(merged, mode);
    mergeBucket(mergedMode.totals, modeEntry.totals);
    mergeNamedBuckets(mergedMode.languages, modeEntry.languages);
    mergeNamedBuckets(mergedMode.languageSets, modeEntry.languageSets);
    for (const [setting, settingEntry] of Object.entries(modeEntry.settings || {})) {
      const targetSetting = ensureSetting(mergedMode, setting, settingEntry.enabled);
      targetSetting.enabled = settingEntry.enabled ?? targetSetting.enabled;
      targetSetting.enabledRuns = Number(targetSetting.enabledRuns) || 0;
      if (settingEntry.enabled) targetSetting.enabledRuns += 1;
      mergeBucket(targetSetting.totals, settingEntry.totals);
      mergeNamedBuckets(targetSetting.languages, settingEntry.languages);
      mergeNamedBuckets(targetSetting.languageSets, settingEntry.languageSets);
    }
  }
  return finalizeFeatureMetrics(merged);
}

async function readMetricsFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeFeatureMetrics({ metricsDir, featureMetrics }) {
  if (!metricsDir || !featureMetrics) return;
  const state = featureMetrics.state || featureMetrics;
  if (!state) return;
  await fs.mkdir(metricsDir, { recursive: true });
  const runMetrics = finalizeFeatureMetrics(JSON.parse(JSON.stringify(state)));
  const runFile = runMetrics.buildId
    ? `feature-metrics-${runMetrics.buildId}.json`
    : 'feature-metrics-run.json';
  await writeJsonObjectFile(
    path.join(metricsDir, runFile),
    { fields: runMetrics, atomic: true }
  );
  const overallPath = path.join(metricsDir, 'feature-metrics.json');
  const existing = await readMetricsFile(overallPath);
  const merged = mergeFeatureMetrics(existing, runMetrics);
  if (merged) {
    await writeJsonObjectFile(
      overallPath,
      { fields: merged, atomic: true }
    );
  }
}
