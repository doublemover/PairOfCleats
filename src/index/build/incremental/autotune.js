import { availableParallelism, cpus } from 'node:os';
import { getEnvConfig } from '../../../shared/env.js';

const DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 12;
const MAX_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 64;
const HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_THRESHOLD = 16384;
const MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY = 96;
const HOT_CROSS_FILE_BUNDLE_UPDATE_WINDOW_MS = 10 * 60 * 1000;
const ENV_CONFIG = getEnvConfig();

export const resolveIncrementalBundleUpdateConcurrency = ({
  totalUpdates,
  cpuIdleRatio = null
}) => {
  const updates = Number.isFinite(Number(totalUpdates)) && totalUpdates > 0
    ? Math.floor(Number(totalUpdates))
    : 1;
  const envRaw = Number(ENV_CONFIG.incrementalBundleUpdateConcurrency);
  if (Number.isFinite(envRaw) && envRaw > 0) {
    return Math.min(updates, Math.max(1, Math.floor(envRaw)));
  }
  const cpuCount = typeof availableParallelism === 'function'
    ? Math.max(1, Math.floor(availableParallelism()))
    : DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY;
  const baseline = Math.max(
    DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY,
    Math.min(MAX_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, cpuCount * 3)
  );
  let resolved = baseline;
  if (updates >= HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_THRESHOLD) {
    const highVolume = Math.max(
      baseline,
      Math.min(MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, cpuCount * 4)
    );
    resolved = highVolume;
  }
  if (Number.isFinite(cpuIdleRatio)) {
    const idle = Math.max(0, Math.min(1, Number(cpuIdleRatio)));
    if (idle >= 0.5) {
      resolved = Math.min(MAX_HIGH_VOLUME_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, Math.ceil(resolved * 1.25));
    } else if (idle <= 0.15) {
      resolved = Math.max(DEFAULT_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY, Math.floor(resolved * 0.75));
    }
  }
  return Math.min(updates, resolved);
};

/**
 * Sample system CPU idle ratio over a short interval.
 *
 * @param {number} [sampleMs=40]
 * @returns {Promise<number|null>}
 */
export const sampleCpuIdleRatio = async (sampleMs = 40) => {
  try {
    const start = cpus();
    if (!Array.isArray(start) || !start.length) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, Math.floor(Number(sampleMs) || 40))));
    const end = cpus();
    if (!Array.isArray(end) || end.length !== start.length) return null;
    let idleDelta = 0;
    let totalDelta = 0;
    for (let i = 0; i < start.length; i += 1) {
      const a = start[i]?.times || {};
      const b = end[i]?.times || {};
      const idle = Math.max(0, Number(b.idle || 0) - Number(a.idle || 0));
      const user = Math.max(0, Number(b.user || 0) - Number(a.user || 0));
      const nice = Math.max(0, Number(b.nice || 0) - Number(a.nice || 0));
      const sys = Math.max(0, Number(b.sys || 0) - Number(a.sys || 0));
      const irq = Math.max(0, Number(b.irq || 0) - Number(a.irq || 0));
      const total = idle + user + nice + sys + irq;
      idleDelta += idle;
      totalDelta += total;
    }
    if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
    return Math.max(0, Math.min(1, idleDelta / totalDelta));
  } catch {
    return null;
  }
};

const comparePendingCrossFileBundleUpdates = (a, b) => {
  const aMtime = Number(a?.entry?.mtimeMs) || 0;
  const bMtime = Number(b?.entry?.mtimeMs) || 0;
  if (aMtime !== bMtime) return bMtime - aMtime;
  const aChunks = Array.isArray(a?.fileChunks) ? a.fileChunks.length : 0;
  const bChunks = Array.isArray(b?.fileChunks) ? b.fileChunks.length : 0;
  if (aChunks !== bChunks) return bChunks - aChunks;
  return String(a?.normalizedFile || a?.file || '').localeCompare(String(b?.normalizedFile || b?.file || ''));
};

const isHotPendingCrossFileBundleUpdate = (pendingUpdate, nowMs = Date.now()) => {
  const mtimeMs = Number(pendingUpdate?.entry?.mtimeMs) || 0;
  return mtimeMs > 0 && (nowMs - mtimeMs) <= HOT_CROSS_FILE_BUNDLE_UPDATE_WINDOW_MS;
};

export const prioritizePendingCrossFileBundleUpdates = (pendingUpdates, { nowMs = Date.now() } = {}) => {
  const hot = [];
  const cold = [];
  for (const pendingUpdate of pendingUpdates) {
    if (isHotPendingCrossFileBundleUpdate(pendingUpdate, nowMs)) {
      hot.push(pendingUpdate);
    } else {
      cold.push(pendingUpdate);
    }
  }
  hot.sort(comparePendingCrossFileBundleUpdates);
  cold.sort(comparePendingCrossFileBundleUpdates);
  return hot.concat(cold);
};
