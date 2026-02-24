import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';

const SCHEDULER_AUTOTUNE_PROFILE_VERSION = 1;
const PROFILE_FILE_NAME = 'scheduler-autotune.json';

/**
 * Clamp optional numeric input to positive integer fallback.
 *
 * @param {unknown} value
 * @param {number|null} fallback
 * @returns {number|null}
 */
const clampPositiveInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/**
 * Clamp optional numeric input into inclusive [0,1] range.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const clampUnit = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

/**
 * Resolve scheduler autotune profile path under repo cache metrics directory.
 *
 * @param {string} repoCacheRoot
 * @returns {string|null}
 */
const resolveProfilePath = (repoCacheRoot) => {
  if (typeof repoCacheRoot !== 'string' || !repoCacheRoot.trim()) return null;
  return path.join(repoCacheRoot, 'metrics', PROFILE_FILE_NAME);
};

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

/**
 * Normalize persisted autotune profile shape and discard invalid payloads.
 *
 * @param {unknown} value
 * @returns {object|null}
 */
const normalizeProfile = (value) => {
  if (!isObject(value)) return null;
  if (Number(value.version) !== SCHEDULER_AUTOTUNE_PROFILE_VERSION) return null;
  const recommended = isObject(value.recommended) ? value.recommended : {};
  const maxCpuTokens = clampPositiveInt(recommended.maxCpuTokens, null);
  const maxIoTokens = clampPositiveInt(recommended.maxIoTokens, null);
  const maxMemoryTokens = clampPositiveInt(recommended.maxMemoryTokens, null);
  if (maxCpuTokens == null && maxIoTokens == null && maxMemoryTokens == null) return null;
  return {
    version: SCHEDULER_AUTOTUNE_PROFILE_VERSION,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : null,
    sourceBuildId: typeof value.sourceBuildId === 'string' ? value.sourceBuildId : null,
    recommended: {
      ...(maxCpuTokens != null ? { maxCpuTokens } : {}),
      ...(maxIoTokens != null ? { maxIoTokens } : {}),
      ...(maxMemoryTokens != null ? { maxMemoryTokens } : {})
    },
    observed: isObject(value.observed) ? value.observed : null
  };
};

/**
 * Load scheduler autotune recommendation profile from repo cache.
 *
 * @param {{repoCacheRoot?:string,log?:(line:string)=>void}} [input]
 * @returns {Promise<object|null>}
 */
export async function loadSchedulerAutoTuneProfile({ repoCacheRoot, log = null } = {}) {
  const profilePath = resolveProfilePath(repoCacheRoot);
  if (!profilePath) return null;
  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    const parsed = normalizeProfile(JSON.parse(raw));
    return parsed || null;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    if (typeof log === 'function') {
      log(`[scheduler] Failed to load autotune profile: ${err?.message || err}`);
    }
    return null;
  }
}

/**
 * Derive next scheduler token recommendations from observed queue/utilization.
 *
 * @param {{schedulerStats?:object,schedulerConfig?:object,buildId?:string|null}} [input]
 * @returns {object|null}
 */
export const deriveSchedulerAutoTuneRecommendation = ({
  schedulerStats,
  schedulerConfig,
  buildId = null
} = {}) => {
  if (!isObject(schedulerStats)) return null;
  const tokens = isObject(schedulerStats.tokens) ? schedulerStats.tokens : {};
  const utilization = isObject(schedulerStats.utilization) ? schedulerStats.utilization : {};
  const activity = isObject(schedulerStats.activity) ? schedulerStats.activity : {};
  const queues = isObject(schedulerStats.queues) ? schedulerStats.queues : {};
  const writeQueue = isObject(queues['stage2.write']) ? queues['stage2.write'] : {};
  const currentCpu = clampPositiveInt(tokens.cpu?.total, 1);
  const currentIo = clampPositiveInt(tokens.io?.total, 1);
  const currentMem = clampPositiveInt(tokens.mem?.total, 1);
  const maxCpu = clampPositiveInt(schedulerConfig?.maxCpuTokens, currentCpu);
  const maxIo = clampPositiveInt(schedulerConfig?.maxIoTokens, currentIo);
  const maxMem = clampPositiveInt(schedulerConfig?.maxMemoryTokens, currentMem);
  const overallUtilization = clampUnit(utilization.overall, 0);
  const memUtilization = clampUnit(utilization.mem, 0);
  const pending = Math.max(0, Number(activity.pending) || 0);
  const pendingBytes = Math.max(0, Number(activity.pendingBytes) || 0);
  const writePending = Math.max(0, Number(writeQueue.pending) || 0);
  const writeWaitP95Ms = Math.max(0, Number(writeQueue.waitP95Ms) || 0);
  const tokenBudget = Math.max(1, currentCpu + currentIo);
  const queuePressure = pending > (tokenBudget * 2);
  const writePressure = writePending > Math.max(8, Math.floor(currentIo * 2))
    || writeWaitP95Ms > 10000;
  const bytePressure = pendingBytes > (128 * 1024 * 1024);
  let nextCpu = maxCpu;
  let nextIo = maxIo;
  let nextMem = maxMem;

  if (queuePressure && overallUtilization < 0.7) {
    const step = pending > (tokenBudget * 4) ? 3 : 2;
    nextCpu = Math.max(currentCpu, maxCpu + step);
    nextIo = Math.max(currentIo, maxIo + step);
  } else if (pending < Math.max(8, tokenBudget) && overallUtilization > 0.92) {
    nextCpu = Math.max(currentCpu, maxCpu - 1);
    nextIo = Math.max(currentIo, maxIo - 1);
  }

  if ((writePressure || bytePressure) && overallUtilization < 0.85) {
    nextIo = Math.max(currentIo, nextIo + 2);
    if (memUtilization < 0.75) {
      nextMem = Math.max(currentMem, nextMem + 1);
    }
  }

  return {
    version: SCHEDULER_AUTOTUNE_PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceBuildId: typeof buildId === 'string' ? buildId : null,
    recommended: {
      maxCpuTokens: Math.max(1, nextCpu),
      maxIoTokens: Math.max(1, nextIo),
      maxMemoryTokens: Math.max(1, nextMem)
    },
    observed: {
      overallUtilization,
      memUtilization,
      pending,
      pendingBytes,
      writePending,
      writeWaitP95Ms
    }
  };
};

/**
 * Persist scheduler autotune recommendation for future startup overrides.
 *
 * @param {{
 *   repoCacheRoot?:string,
 *   schedulerStats?:object,
 *   schedulerConfig?:object,
 *   buildId?:string|null,
 *   log?:(line:string)=>void
 * }} [input]
 * @returns {Promise<object|null>}
 */
export async function writeSchedulerAutoTuneProfile({
  repoCacheRoot,
  schedulerStats,
  schedulerConfig,
  buildId = null,
  log = null
} = {}) {
  const profilePath = resolveProfilePath(repoCacheRoot);
  if (!profilePath) return null;
  const payload = deriveSchedulerAutoTuneRecommendation({
    schedulerStats,
    schedulerConfig,
    buildId
  });
  if (!payload) return null;
  try {
    await atomicWriteJson(profilePath, payload, { spaces: 2, newline: true });
    return payload;
  } catch (err) {
    if (typeof log === 'function') {
      log(`[scheduler] Failed to persist autotune profile: ${err?.message || err}`);
    }
    return null;
  }
}
