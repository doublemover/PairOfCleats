import os from 'node:os';
import { normalizeNonNegativeInt, normalizeRatio } from './scheduler-core-normalize.js';

/**
 * Resolve adaptive system signals from a sampler override or host telemetry.
 *
 * Returns both the resolved signal envelope and updated memory-history state
 * used to compute gc pressure deltas.
 *
 * @param {{
 *   at:number,
 *   input:object,
 *   telemetryStage:string,
 *   cloneTokenState:()=>object,
 *   tokens:{cpu:{total:number,used:number},io:{total:number,used:number},mem:{total:number,used:number}},
 *   lastMemorySignals:object|null
 * }} input
 * @returns {{signals:object,nextMemorySignals:object|null}}
 */
export const resolveSchedulerSystemSignals = ({
  at,
  input,
  telemetryStage,
  cloneTokenState,
  tokens,
  lastMemorySignals
}) => {
  const cpuTokenUtilization = tokens.cpu.total > 0 ? (tokens.cpu.used / tokens.cpu.total) : 0;
  const ioTokenUtilization = tokens.io.total > 0 ? (tokens.io.used / tokens.io.total) : 0;
  const memTokenUtilization = tokens.mem.total > 0 ? (tokens.mem.used / tokens.mem.total) : 0;
  const defaultSignals = {
    cpu: {
      tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
      loadRatio: 0
    },
    memory: {
      rssBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 0,
      freeBytes: 0,
      totalBytes: 0,
      rssUtilization: null,
      heapUtilization: null,
      freeRatio: null,
      pressureScore: Math.max(memTokenUtilization, 0),
      gcPressureScore: 0
    }
  };
  if (typeof input.adaptiveSignalSampler === 'function') {
    try {
      const sampled = input.adaptiveSignalSampler({
        at,
        stage: telemetryStage,
        tokens: cloneTokenState()
      });
      if (sampled && typeof sampled === 'object') {
        const cpuToken = normalizeRatio(
          sampled?.cpu?.tokenUtilization,
          defaultSignals.cpu.tokenUtilization,
          { min: 0, max: 1.5 }
        );
        const cpuLoad = normalizeRatio(sampled?.cpu?.loadRatio, defaultSignals.cpu.loadRatio, { min: 0, max: 2 });
        const pressureScore = normalizeRatio(
          sampled?.memory?.pressureScore,
          defaultSignals.memory.pressureScore,
          { min: 0, max: 2 }
        );
        const gcPressureScore = normalizeRatio(
          sampled?.memory?.gcPressureScore,
          defaultSignals.memory.gcPressureScore,
          { min: 0, max: 2 }
        );
        defaultSignals.cpu = {
          tokenUtilization: cpuToken,
          loadRatio: cpuLoad
        };
        defaultSignals.memory = {
          ...defaultSignals.memory,
          pressureScore,
          gcPressureScore,
          rssBytes: normalizeNonNegativeInt(sampled?.memory?.rssBytes, defaultSignals.memory.rssBytes),
          heapUsedBytes: normalizeNonNegativeInt(sampled?.memory?.heapUsedBytes, defaultSignals.memory.heapUsedBytes),
          heapTotalBytes: normalizeNonNegativeInt(sampled?.memory?.heapTotalBytes, defaultSignals.memory.heapTotalBytes),
          freeBytes: normalizeNonNegativeInt(sampled?.memory?.freeBytes, defaultSignals.memory.freeBytes),
          totalBytes: normalizeNonNegativeInt(sampled?.memory?.totalBytes, defaultSignals.memory.totalBytes),
          rssUtilization: normalizeRatio(sampled?.memory?.rssUtilization, defaultSignals.memory.rssUtilization, { min: 0, max: 1 }),
          heapUtilization: normalizeRatio(sampled?.memory?.heapUtilization, defaultSignals.memory.heapUtilization, { min: 0, max: 1 }),
          freeRatio: normalizeRatio(sampled?.memory?.freeRatio, defaultSignals.memory.freeRatio, { min: 0, max: 1 })
        };
        return {
          signals: defaultSignals,
          nextMemorySignals: lastMemorySignals
        };
      }
    } catch {}
  }
  const cpuCount = typeof os.availableParallelism === 'function'
    ? Math.max(1, os.availableParallelism())
    : Math.max(1, os.cpus().length || 1);
  const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
  const loadRatio = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) && cpuCount > 0
    ? Math.max(0, Math.min(2, Number(loadAvg[0]) / cpuCount))
    : 0;
  let rssBytes = 0;
  let heapUsedBytes = 0;
  let heapTotalBytes = 0;
  try {
    const usage = process.memoryUsage();
    rssBytes = Number(usage?.rss) || 0;
    heapUsedBytes = Number(usage?.heapUsed) || 0;
    heapTotalBytes = Number(usage?.heapTotal) || 0;
  } catch {}
  const totalBytes = Number(os.totalmem()) || 0;
  const freeBytes = Number(os.freemem()) || 0;
  const rssUtilization = totalBytes > 0 ? Math.max(0, Math.min(1, rssBytes / totalBytes)) : null;
  const heapUtilization = heapTotalBytes > 0 ? Math.max(0, Math.min(1, heapUsedBytes / heapTotalBytes)) : null;
  const freeRatio = totalBytes > 0 ? Math.max(0, Math.min(1, freeBytes / totalBytes)) : null;
  const freePressure = Number.isFinite(freeRatio) ? (1 - freeRatio) : 0;
  const memoryPressureScore = Math.max(
    memTokenUtilization,
    Number.isFinite(rssUtilization) ? rssUtilization : 0,
    Number.isFinite(heapUtilization) ? heapUtilization : 0,
    freePressure
  );
  let gcPressureScore = 0;
  if (lastMemorySignals && Number(lastMemorySignals.heapUsedBytes) > 0) {
    const priorHeap = Number(lastMemorySignals.heapUsedBytes) || 0;
    const delta = priorHeap - heapUsedBytes;
    if (delta > 0) {
      gcPressureScore = Math.max(0, Math.min(1, delta / Math.max(1, priorHeap)));
    }
  }
  return {
    signals: {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio
      },
      memory: {
        rssBytes,
        heapUsedBytes,
        heapTotalBytes,
        freeBytes,
        totalBytes,
        rssUtilization,
        heapUtilization,
        freeRatio,
        pressureScore: memoryPressureScore,
        gcPressureScore
      }
    },
    nextMemorySignals: { heapUsedBytes }
  };
};
