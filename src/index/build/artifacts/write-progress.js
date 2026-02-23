/**
 * Build artifact-write progress/telemetry helpers with shared mutable state.
 *
 * @param {object} input
 * @param {object|null} [input.telemetry]
 * @param {Map<string, number>} input.activeWrites
 * @param {Map<string, number>} input.activeWriteBytes
 * @param {object} [input.writeProgressMeta]
 * @param {number} [input.writeLogIntervalMs]
 * @param {(label:string,completed:number,total:number,meta:object)=>void} input.showProgress
 * @param {(line:string,meta?:object)=>void} input.logLine
 * @param {() => number} [input.now]
 * @returns {{setTotalWrites:(value:number)=>void,getTotalWrites:()=>number,getCompletedWrites:()=>number,getLongestWriteStallSeconds:()=>number,updateWriteInFlightTelemetry:()=>void,logWriteProgress:(label:string)=>void}}
 */
export function createArtifactWriteProgressTracker({
  telemetry = null,
  activeWrites,
  activeWriteBytes,
  writeProgressMeta = {},
  writeLogIntervalMs = 0,
  showProgress,
  logLine,
  now = Date.now
}) {
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';

  /**
   * Publish current write in-flight bytes/count into runtime telemetry.
   *
   * @returns {void}
   */
  const updateWriteInFlightTelemetry = () => {
    if (!telemetry || typeof telemetry.setInFlightBytes !== 'function') return;
    let bytes = 0;
    for (const value of activeWriteBytes.values()) {
      if (Number.isFinite(value) && value > 0) bytes += value;
    }
    telemetry.setInFlightBytes('artifacts.write', {
      bytes,
      count: activeWrites.size
    });
  };

  /**
   * Compute longest active write runtime in seconds.
   *
   * @returns {number}
   */
  const getLongestWriteStallSeconds = () => {
    if (!activeWrites.size) return 0;
    const nowMs = now();
    let longest = 0;
    for (const startedAt of activeWrites.values()) {
      const elapsed = Math.max(0, nowMs - (Number(startedAt) || nowMs));
      if (elapsed > longest) longest = elapsed;
    }
    return Math.max(0, Math.round(longest / 1000));
  };

  /**
   * Emit periodic write-progress summary and stall diagnostics.
   *
   * @param {string} label
   * @returns {void}
   */
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    showProgress('Artifacts', completedWrites, totalWrites, {
      ...writeProgressMeta,
      message: label || null
    });
    const nowMs = now();
    if (completedWrites === totalWrites || completedWrites === 1 || (nowMs - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = nowMs;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
    }
  };

  return {
    setTotalWrites: (value) => {
      const parsed = Number(value);
      totalWrites = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    },
    getTotalWrites: () => totalWrites,
    getCompletedWrites: () => completedWrites,
    getLongestWriteStallSeconds,
    updateWriteInFlightTelemetry,
    logWriteProgress
  };
}
