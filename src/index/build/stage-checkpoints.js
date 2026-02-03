import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { updateBuildState } from './build-state.js';

const STAGE_CHECKPOINT_VERSION = 1;

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeLabel = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
};

const normalizeFileLabel = (value, fallback = 'unknown') => {
  const raw = normalizeLabel(value, fallback);
  return String(raw).replace(/[^a-zA-Z0-9._-]+/g, '_');
};

const captureMemorySnapshot = () => {
  const usage = process.memoryUsage();
  return {
    rss: Number.isFinite(usage?.rss) ? usage.rss : null,
    heapUsed: Number.isFinite(usage?.heapUsed) ? usage.heapUsed : null,
    heapTotal: Number.isFinite(usage?.heapTotal) ? usage.heapTotal : null,
    external: Number.isFinite(usage?.external) ? usage.external : null,
    arrayBuffers: Number.isFinite(usage?.arrayBuffers) ? usage.arrayBuffers : null
  };
};

const updateHighWater = (target, source) => {
  if (!isObject(target) || !isObject(source)) return;
  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (Number.isFinite(value)) {
      const current = target[key];
      if (!Number.isFinite(current) || value > current) target[key] = value;
      continue;
    }
    if (isObject(value)) {
      if (!isObject(target[key])) target[key] = {};
      updateHighWater(target[key], value);
    }
  }
};

/**
 * Create a stage checkpoint recorder for indexing stages.
 *
 * Determinism: checkpoints are recorded in the order invoked; summaries are stable.
 * Side effects: optional writes to build_state and metrics directory.
 *
 * @param {{ buildRoot?: string|null, metricsDir?: string|null, mode?: string|null, buildId?: string|null }} [options]
 * @returns {{ record: Function, buildSummary: Function, flush: Function, checkpoints: object[] }}
 */
export const createStageCheckpointRecorder = ({
  buildRoot = null,
  metricsDir = null,
  mode = null,
  buildId = null
} = {}) => {
  const startedMs = Date.now();
  const checkpoints = [];
  const highWater = { memory: {}, extra: {} };
  const stages = {};

  const record = ({
    stage,
    step = null,
    label = null,
    extra = null,
    memory = null
  } = {}) => {
    const now = Date.now();
    const memorySnapshot = memory || captureMemorySnapshot();
    const stageKey = normalizeLabel(stage, 'unknown');
    const entry = {
      at: new Date(now).toISOString(),
      elapsedMs: now - startedMs,
      stage: stageKey,
      step: normalizeLabel(step, null),
      label: normalizeLabel(label, null),
      memory: memorySnapshot,
      extra: isObject(extra) ? extra : null
    };
    checkpoints.push(entry);
    updateHighWater(highWater.memory, memorySnapshot);
    updateHighWater(highWater.extra, entry.extra || {});

    const stageEntry = stages[stageKey] || {
      stage: stageKey,
      firstAt: entry.at,
      firstElapsedMs: entry.elapsedMs,
      lastAt: entry.at,
      lastElapsedMs: entry.elapsedMs,
      checkpointCount: 0,
      memoryHighWater: {},
      extraHighWater: {}
    };
    stageEntry.lastAt = entry.at;
    stageEntry.lastElapsedMs = entry.elapsedMs;
    stageEntry.checkpointCount += 1;
    updateHighWater(stageEntry.memoryHighWater, memorySnapshot);
    updateHighWater(stageEntry.extraHighWater, entry.extra || {});
    stages[stageKey] = stageEntry;
    return entry;
  };

  const buildSummary = () => {
    const stageSummaries = {};
    for (const [stageKey, entry] of Object.entries(stages)) {
      stageSummaries[stageKey] = {
        stage: stageKey,
        startedAt: entry.firstAt,
        finishedAt: entry.lastAt,
        elapsedMs: Math.max(0, entry.lastElapsedMs - entry.firstElapsedMs),
        checkpointCount: entry.checkpointCount,
        memoryHighWater: entry.memoryHighWater,
        extraHighWater: entry.extraHighWater
      };
    }
    return {
      version: STAGE_CHECKPOINT_VERSION,
      generatedAt: new Date().toISOString(),
      buildId: buildId || null,
      mode: mode || null,
      checkpoints,
      stages: stageSummaries,
      highWater
    };
  };

  const flush = async () => {
    const summary = buildSummary();
    const stageKeys = Object.keys(summary.stages || {});
    const stageKey = stageKeys.length === 1 ? stageKeys[0] : 'multi';
    if (buildRoot) {
      try {
        await updateBuildState(buildRoot, {
          stageCheckpoints: {
            [mode || 'unknown']: {
              [stageKey]: summary
            }
          }
        });
      } catch (err) {
        console.warn(`[metrics] Failed to update build state checkpoints: ${err?.message || err}`);
      }
    }
    if (metricsDir) {
      const safeStage = normalizeFileLabel(stageKey);
      const safeMode = normalizeFileLabel(mode || 'unknown');
      const fileName = mode
        ? `stage-audit-${safeMode}-${safeStage}.json`
        : `stage-audit-${safeStage}.json`;
      try {
        await fs.mkdir(metricsDir, { recursive: true });
        await writeJsonObjectFile(path.join(metricsDir, fileName), { fields: summary, atomic: true });
      } catch (err) {
        console.warn(`[metrics] Failed to write stage checkpoints: ${err?.message || err}`);
      }
    }
    return summary;
  };

  return {
    record,
    buildSummary,
    flush,
    checkpoints
  };
};
