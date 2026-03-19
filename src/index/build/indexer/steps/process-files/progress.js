import { compareStrings } from '../../../../../shared/sort.js';
import { showProgress } from '../../../../../shared/progress.js';

/**
 * Render watchdog heartbeat progress text for stage1 processing loop.
 *
 * @param {{
 *  count?:number,
 *  total?:number,
 *  startedAtMs?:number,
 *  nowMs?:number,
 *  inFlight?:number,
 *  trackedSubprocesses?:number
 * }} [input]
 * @returns {string}
 */
export const buildFileProgressHeartbeatText = ({
  count = 0,
  total = 0,
  startedAtMs = Date.now(),
  nowMs = Date.now(),
  inFlight = 0,
  trackedSubprocesses = 0
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
  return (
    `[watchdog] progress ${safeCount}/${safeTotal} (${percent}%) `
    + `elapsed=${elapsedSec}s rate=${ratePerSec.toFixed(2)} files/s eta=${etaText} `
    + `inFlight=${safeInFlight} trackedSubprocesses=${safeTracked}`
  );
};

/**
 * Create a shared stage1 progress tracker that supports ordered and shard-local
 * progress updates without double-counting.
 *
 * @param {{total?:number,mode?:string,checkpoint?:object,onTick?:Function}} [input]
 * @returns {{
 *   progress:{total:number,count:number,tick:Function},
 *   markOrderedEntryComplete:Function,
 *   snapshot:Function
 * }}
 */
export const createStage1ProgressTracker = ({
  total = 0,
  mode = 'unknown',
  checkpoint = null,
  onTick = null
} = {}) => {
  const completedOrderIndexes = new Set();
  const completedFallbackKeys = new Set();
  const safeTotal = Number.isFinite(Number(total))
    ? Math.max(0, Math.floor(Number(total)))
    : 0;
  const progress = {
    total: safeTotal,
    count: 0,
    tick() {
      this.count += 1;
      if (typeof onTick === 'function') onTick(this.count);
      showProgress('Files', this.count, this.total, { stage: 'processing', mode });
      checkpoint?.tick?.();
    }
  };
  /**
   * Advance progress exactly once per order index.
   *
   * @param {number|null} orderIndex
   * @param {{count:number,total:number,meta:object}|null} [shardProgress]
   * @param {string|null} [dedupeKey]
   * @returns {boolean}
   */
  const markOrderedEntryComplete = (orderIndex, shardProgress = null, dedupeKey = null) => {
    if (!progress || typeof progress.tick !== 'function') return false;
    if (Number.isFinite(orderIndex)) {
      const normalizedOrderIndex = Math.floor(orderIndex);
      if (completedOrderIndexes.has(normalizedOrderIndex)) return false;
      completedOrderIndexes.add(normalizedOrderIndex);
    } else if (typeof dedupeKey === 'string' && dedupeKey) {
      if (completedFallbackKeys.has(dedupeKey)) return false;
      completedFallbackKeys.add(dedupeKey);
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
    snapshot() {
      return {
        total: progress.total,
        count: progress.count,
        completedOrderIndices: Array.from(completedOrderIndexes).sort((a, b) => a - b),
        completedFallbackKeys: Array.from(completedFallbackKeys).sort((a, b) => compareStrings(a, b))
      };
    }
  };
};
