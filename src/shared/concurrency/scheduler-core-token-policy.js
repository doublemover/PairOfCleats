import os from 'node:os';

const resolveMemorySignalValue = (value, fallback) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
};

/**
 * Smooth adaptive control values to avoid oscillation on sparse bursts.
 *
 * @param {number|null} previous
 * @param {number} next
 * @param {number} [alpha=0.25]
 * @returns {number}
 */
export const smoothAdaptiveValue = (previous, next, alpha = 0.25) => (
  previous == null ? next : ((previous * (1 - alpha)) + (next * alpha))
);

/**
 * Selects the next adaptation interval from current pressure state.
 *
 * @param {{
 *   adaptiveMinIntervalMs:number,
 *   pendingPressure:boolean,
 *   bytePressure:boolean,
 *   starvationScore:number,
 *   mostlyIdle:boolean
 * }} input
 * @returns {number}
 */
export const resolveAdaptiveIntervalMs = ({
  adaptiveMinIntervalMs,
  pendingPressure,
  bytePressure,
  starvationScore,
  mostlyIdle
}) => {
  if (pendingPressure || bytePressure || starvationScore > 0) {
    return Math.max(50, Math.floor(adaptiveMinIntervalMs * 0.5));
  }
  if (mostlyIdle) {
    return Math.min(2000, Math.max(adaptiveMinIntervalMs, Math.floor(adaptiveMinIntervalMs * 2)));
  }
  return adaptiveMinIntervalMs;
};

/**
 * Resolves memory headroom and token-cap constraints for adaptive scaling.
 *
 * Reuses previously sampled system signals when available to avoid redundant
 * host memory probes during the same adaptation cycle.
 *
 * @param {{
 *   signals?:{memory?:{totalBytes?:number,freeBytes?:number}}|null,
 *   adaptiveMemoryReserveMb:number,
 *   adaptiveMemoryPerTokenMb:number,
 *   baselineMemLimit:number,
 *   maxMemLimit:number,
 *   currentMemTotal:number,
 *   currentMemUsed:number
 * }} input
 * @returns {{
 *   totalBytes:number,
 *   freeBytes:number,
 *   freeRatio:number|null,
 *   headroomBytes:number,
 *   memoryLowHeadroom:boolean,
 *   memoryHighHeadroom:boolean,
 *   memoryTokenHeadroomCap:number,
 *   nextMemTotal:number
 * }}
 */
export const resolveAdaptiveMemoryHeadroom = ({
  signals = null,
  adaptiveMemoryReserveMb,
  adaptiveMemoryPerTokenMb,
  baselineMemLimit,
  maxMemLimit,
  currentMemTotal,
  currentMemUsed
}) => {
  const sampledTotalBytes = Number(signals?.memory?.totalBytes);
  const sampledFreeBytes = Number(signals?.memory?.freeBytes);
  const totalBytes = resolveMemorySignalValue(
    sampledTotalBytes > 0 ? sampledTotalBytes : null,
    os.totalmem()
  );
  const freeBytes = resolveMemorySignalValue(
    sampledFreeBytes >= 0 ? sampledFreeBytes : null,
    os.freemem()
  );
  const freeRatio = totalBytes > 0 ? (freeBytes / totalBytes) : null;
  const headroomBytes = Number.isFinite(totalBytes) && Number.isFinite(freeBytes)
    ? Math.max(0, freeBytes)
    : 0;
  const memoryLowHeadroom = Number.isFinite(freeRatio) && freeRatio < 0.15;
  const memoryHighHeadroom = !Number.isFinite(freeRatio) || freeRatio > 0.25;
  let memoryTokenHeadroomCap = maxMemLimit;
  if (Number.isFinite(freeBytes) && freeBytes > 0) {
    const reserveBytes = adaptiveMemoryReserveMb * 1024 * 1024;
    const bytesPerToken = adaptiveMemoryPerTokenMb * 1024 * 1024;
    const availableBytes = Math.max(0, freeBytes - reserveBytes);
    const headroomTokens = Math.max(1, Math.floor(availableBytes / Math.max(1, bytesPerToken)));
    memoryTokenHeadroomCap = Math.max(
      baselineMemLimit,
      Math.min(maxMemLimit, headroomTokens)
    );
  }
  const nextMemTotal = currentMemTotal > memoryTokenHeadroomCap
    ? Math.max(currentMemUsed, memoryTokenHeadroomCap)
    : currentMemTotal;
  return {
    totalBytes,
    freeBytes,
    freeRatio,
    headroomBytes,
    memoryLowHeadroom,
    memoryHighHeadroom,
    memoryTokenHeadroomCap,
    nextMemTotal
  };
};

/**
 * Applies downscale pressure while honoring queue floors and in-flight usage.
 *
 * @param {{
 *   tokens:{cpu:{total:number,used:number},io:{total:number,used:number},mem:{total:number,used:number}},
 *   cpuFloor:number,
 *   ioFloor:number,
 *   memFloor:number,
 *   adaptiveStep:number,
 *   memoryTokenHeadroomCap?:number
 * }} input
 */
export const decayAdaptiveTokenTotals = ({
  tokens,
  cpuFloor,
  ioFloor,
  memFloor,
  adaptiveStep,
  memoryTokenHeadroomCap = Number.POSITIVE_INFINITY
}) => {
  tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
  tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
  tokens.mem.total = Math.max(
    memFloor,
    tokens.mem.used,
    Math.min(memoryTokenHeadroomCap, tokens.mem.total - adaptiveStep)
  );
};
