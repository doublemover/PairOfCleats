import { compareStrings } from '../../../../../shared/sort.js';
import { coerceNumberAtLeast } from '../../../../../shared/number-coerce.js';
import { showProgress } from '../../../../../shared/progress-runtime.js';

const nonNegativeFinite = (value) => coerceNumberAtLeast(value, 0) ?? 0;

/**
 * Render watchdog heartbeat progress text for stage1 processing loop.
 *
 * @param {{
 *  count?:number,
 *  total?:number,
 *  startedAtMs?:number,
 *  nowMs?:number,
 *  inFlight?:number,
 *  trackedSubprocesses?:number,
 *  workload?:object|null
 * }} [input]
 * @returns {string}
 */
export const buildFileProgressHeartbeatText = ({
  count = 0,
  total = 0,
  startedAtMs = Date.now(),
  nowMs = Date.now(),
  inFlight = 0,
  trackedSubprocesses = 0,
  workload = null
} = {}) => {
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0;
  const safeCount = Number.isFinite(Number(count))
    ? Math.max(0, Math.min(safeTotal || Number.MAX_SAFE_INTEGER, Math.floor(Number(count))))
    : 0;
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const safeStartedAtMs = Number.isFinite(Number(startedAtMs)) ? Number(startedAtMs) : safeNowMs;
  const elapsedMs = Math.max(1, safeNowMs - safeStartedAtMs);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const ratePerSec = safeCount > 0 ? (safeCount / (elapsedMs / 1000)) : 0;
  const remaining = safeTotal > safeCount ? (safeTotal - safeCount) : 0;
  const etaSec = ratePerSec > 0 ? Math.ceil(remaining / ratePerSec) : null;
  const percent = safeTotal > 0
    ? ((safeCount / safeTotal) * 100).toFixed(1)
    : '0.0';
  const etaText = Number.isFinite(etaSec) ? `${etaSec}s` : 'n/a';
  const safeInFlight = Number.isFinite(Number(inFlight)) ? Math.max(0, Math.floor(Number(inFlight))) : 0;
  const safeTracked = Number.isFinite(Number(trackedSubprocesses))
    ? Math.max(0, Math.floor(Number(trackedSubprocesses)))
    : 0;
  const weighted = workload && typeof workload === 'object'
    ? ` inputMiB=${(nonNegativeFinite(workload.terminalInputBytes) / 1048576).toFixed(2)}/${(nonNegativeFinite(workload.totalInputBytes) / 1048576).toFixed(2)}`
      + ` inputMiB/s=${(nonNegativeFinite(workload.terminalInputBytes) / 1048576 / (elapsedMs / 1000)).toFixed(2)}`
      + ` chunks=${nonNegativeFinite(workload.chunksProduced)} cached=${nonNegativeFinite(workload.cachedFiles)}`
      + ` skipped=${nonNegativeFinite(workload.skippedFiles)} failed=${nonNegativeFinite(workload.failedFiles)}`
    : '';
  return (
    `[watchdog] progress ${safeCount}/${safeTotal} (${percent}%) `
    + `elapsed=${elapsedSec}s rate=${ratePerSec.toFixed(2)} files/s eta=${etaText} `
    + `inFlight=${safeInFlight} trackedSubprocesses=${safeTracked}${weighted}`
  );
};

/**
 * Create a shared stage1 progress tracker that supports ordered and shard-local
 * progress updates without double-counting.
 *
 * @param {{total?:number,mode?:string,checkpoint?:object,onTick?:Function,totalInputBytes?:number}} [input]
 * @returns {{
 *   progress:{total:number,count:number,tick:Function},
 *   markOrderedEntryComplete:Function,
 *   workloadSnapshot:Function,
 *   snapshot:Function
 * }}
 */
export const createStage1ProgressTracker = ({
  total = 0,
  mode = 'unknown',
  checkpoint = null,
  onTick = null,
  totalInputBytes = 0
} = {}) => {
  const completedOrderIndexes = new Set();
  const completedFallbackKeys = new Set();
  const safeTotal = Number.isFinite(Number(total))
    ? Math.max(0, Math.floor(Number(total)))
    : 0;
  // These are terminal input weights, not predicted analysis work or a RAM
  // estimate. Skips/failures are explicit and do not inflate successful chunks.
  const workload = { totalInputBytes: nonNegativeFinite(totalInputBytes),
    terminalInputBytes: 0, chunksProduced: 0, cachedFiles: 0, skippedFiles: 0, failedFiles: 0 };
  const progress = {
    total: safeTotal,
    count: 0,
    tick() {
      this.count += 1;
      if (typeof onTick === 'function') onTick(this.count);
      const message = workload.terminalInputBytes > 0
        ? `${(nonNegativeFinite(workload.terminalInputBytes) / 1048576).toFixed(1)} MiB input; ${workload.chunksProduced} chunks; ${workload.cachedFiles} cached`
        : null;
      showProgress('Files', this.count, this.total, { stage: 'processing', mode, ...(message ? { message } : {}) });
      checkpoint?.tick?.();
    }
  };
  /**
   * Advance progress exactly once per order index.
   *
   * @param {number|null} orderIndex
   * @param {{count:number,total:number,meta:object}|null} [shardProgress]
   * @param {string|null} [dedupeKey]
   * @param {{inputBytes?:number,chunks?:number,cached?:boolean,status?:string}|null} [outcome]
   * @returns {boolean}
   */
  const markOrderedEntryComplete = (orderIndex, shardProgress = null, dedupeKey = null, outcome = null) => {
    if (!progress || typeof progress.tick !== 'function') return false;
    if (Number.isFinite(orderIndex)) {
      const normalizedOrderIndex = Math.floor(orderIndex);
      if (completedOrderIndexes.has(normalizedOrderIndex)) return false;
      completedOrderIndexes.add(normalizedOrderIndex);
    } else if (typeof dedupeKey === 'string' && dedupeKey) {
      if (completedFallbackKeys.has(dedupeKey)) return false;
      completedFallbackKeys.add(dedupeKey);
    }
    if (outcome && typeof outcome === 'object') {
      workload.terminalInputBytes += nonNegativeFinite(outcome.inputBytes);
      workload.chunksProduced += Math.floor(nonNegativeFinite(outcome.chunks));
      if (outcome.cached === true) workload.cachedFiles += 1;
      if (outcome.status === 'skipped') workload.skippedFiles += 1;
      if (outcome.status === 'failed') workload.failedFiles += 1;
    }
    progress.tick();
    if (shardProgress) {
      shardProgress.count += 1;
      showProgress('Shard', shardProgress.count, shardProgress.total, shardProgress.meta);
    }
    return true;
  };
  return {
    progress,
    markOrderedEntryComplete,
    workloadSnapshot: () => ({ ...workload }),
    snapshot() {
      return {
        total: progress.total,
        count: progress.count,
        workload: { ...workload },
        completedOrderIndices: Array.from(completedOrderIndexes).sort((a, b) => a - b),
        completedFallbackKeys: Array.from(completedFallbackKeys).sort((a, b) => compareStrings(a, b))
      };
    }
  };
};
