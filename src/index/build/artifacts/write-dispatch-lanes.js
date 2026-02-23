import { resolveArtifactWorkClassConcurrency } from './lane-policy.js';
import { selectMicroWriteBatch } from './write-strategy.js';

const DISPATCH_LANES = Object.freeze(['ultraLight', 'massive', 'light', 'heavy']);
const DISPATCH_LANE_PRIORITY = Object.freeze(['ultraLight', 'massive', 'heavy', 'light']);

/**
 * Resolve queue length for one lane from a lane queue map.
 *
 * @param {Record<string,Array<object>>} laneQueues
 * @param {'ultraLight'|'massive'|'light'|'heavy'} laneName
 * @returns {number}
 */
const resolveLaneQueueLength = (laneQueues, laneName) => {
  const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
  return queue ? queue.length : 0;
};

/**
 * Resolve active write count for one lane from lane activity state.
 *
 * @param {Record<string,number>} laneActive
 * @param {'ultraLight'|'massive'|'light'|'heavy'} laneName
 * @returns {number}
 */
const resolveLaneActiveCount = (laneActive, laneName) => {
  const value = Number(laneActive?.[laneName]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
};

/**
 * Count queued entries across all lane queues.
 *
 * @param {Record<string,Array<object>>} laneQueues
 * @returns {number}
 */
export const countPendingLaneWrites = (laneQueues) => {
  let pending = 0;
  for (const laneName of DISPATCH_LANES) {
    pending += resolveLaneQueueLength(laneQueues, laneName);
  }
  return pending;
};

/**
 * Determine whether at least one lane queue still has queued writes.
 *
 * @param {Record<string,Array<object>>} laneQueues
 * @returns {boolean}
 */
export const hasPendingLaneWrites = (laneQueues) => countPendingLaneWrites(laneQueues) > 0;

/**
 * Compute per-lane concurrency budgets from work-class budgets.
 *
 * Work classes map to lanes as:
 * `small -> ultraLight+light`, `medium -> heavy`, `large -> massive`.
 * The small budget intentionally reserves up to two ultra-light slots before
 * filling light-lane slots so tiny metadata writes can drain quickly.
 *
 * @param {object} input
 * @param {Record<string,Array<object>>} input.laneQueues
 * @param {Record<string,number>} input.laneActive
 * @param {number} input.writeConcurrency
 * @param {number|null} [input.smallConcurrencyOverride]
 * @param {number|null} [input.mediumConcurrencyOverride]
 * @param {number|null} [input.largeConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,massiveConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
export const resolveDispatchLaneBudgets = ({
  laneQueues,
  laneActive,
  writeConcurrency,
  smallConcurrencyOverride = null,
  mediumConcurrencyOverride = null,
  largeConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const ultraLightWritesTotal = resolveLaneQueueLength(laneQueues, 'ultraLight')
    + resolveLaneActiveCount(laneActive, 'ultraLight');
  const lightWritesTotal = resolveLaneQueueLength(laneQueues, 'light')
    + resolveLaneActiveCount(laneActive, 'light');
  const mediumWritesTotal = resolveLaneQueueLength(laneQueues, 'heavy')
    + resolveLaneActiveCount(laneActive, 'heavy');
  const largeWritesTotal = resolveLaneQueueLength(laneQueues, 'massive')
    + resolveLaneActiveCount(laneActive, 'massive');

  const workClass = resolveArtifactWorkClassConcurrency({
    writeConcurrency,
    smallWrites: ultraLightWritesTotal + lightWritesTotal,
    mediumWrites: mediumWritesTotal,
    largeWrites: largeWritesTotal,
    smallConcurrencyOverride,
    mediumConcurrencyOverride,
    largeConcurrencyOverride,
    hostConcurrency
  });

  const smallBudget = Math.max(0, workClass.smallConcurrency);
  let ultraLightConcurrency = 0;
  let lightConcurrency = 0;
  if (smallBudget > 0) {
    if (ultraLightWritesTotal > 0) {
      const ultraReserve = Math.max(1, Math.min(2, smallBudget));
      ultraLightConcurrency = Math.min(ultraLightWritesTotal, ultraReserve);
    }
    const remainingAfterUltra = Math.max(0, smallBudget - ultraLightConcurrency);
    lightConcurrency = Math.min(lightWritesTotal, remainingAfterUltra);
    let remainingAfterLight = Math.max(0, smallBudget - ultraLightConcurrency - lightConcurrency);
    if (remainingAfterLight > 0 && lightWritesTotal > lightConcurrency) {
      const growLight = Math.min(remainingAfterLight, lightWritesTotal - lightConcurrency);
      lightConcurrency += growLight;
      remainingAfterLight -= growLight;
    }
    if (remainingAfterLight > 0 && ultraLightWritesTotal > ultraLightConcurrency) {
      ultraLightConcurrency += Math.min(remainingAfterLight, ultraLightWritesTotal - ultraLightConcurrency);
    }
  }

  return {
    ultraLightConcurrency,
    massiveConcurrency: workClass.largeConcurrency,
    lightConcurrency,
    heavyConcurrency: workClass.mediumConcurrency
  };
};

/**
 * Select the highest-priority lane that has queued work and available budget.
 *
 * Priority order intentionally differs from object key order:
 * `ultraLight -> massive -> heavy -> light`.
 *
 * @param {object} input
 * @param {Record<string,Array<object>>} input.laneQueues
 * @param {Record<string,number>} input.laneActive
 * @param {{ultraLightConcurrency:number,massiveConcurrency:number,lightConcurrency:number,heavyConcurrency:number}} input.budgets
 * @returns {'ultraLight'|'massive'|'light'|'heavy'|null}
 */
export const pickDispatchLane = ({ laneQueues, laneActive, budgets }) => {
  const laneAvailable = (laneName, laneBudget) => (
    resolveLaneQueueLength(laneQueues, laneName) > 0
    && resolveLaneActiveCount(laneActive, laneName) < Math.max(0, Number(laneBudget) || 0)
  );
  if (laneAvailable('ultraLight', budgets?.ultraLightConcurrency)) return 'ultraLight';
  if (laneAvailable('massive', budgets?.massiveConcurrency)) return 'massive';
  if (laneAvailable('heavy', budgets?.heavyConcurrency)) return 'heavy';
  if (laneAvailable('light', budgets?.lightConcurrency)) return 'light';
  return null;
};

/**
 * Dequeue one dispatch unit from a lane queue.
 *
 * Ultra-light lane supports deterministic micro-batch dequeue in front of
 * regular single-entry dispatch to reduce scheduler overhead for tiny writes.
 *
 * @param {object} input
 * @param {Record<string,Array<object>>} input.laneQueues
 * @param {'ultraLight'|'massive'|'light'|'heavy'} input.laneName
 * @param {{microCoalescing?:boolean,microBatchMaxCount?:number,microBatchMaxBytes?:number}} input.writeFsStrategy
 * @param {number} input.ultraLightWriteThresholdBytes
 * @returns {Array<object>}
 */
export const takeLaneDispatchEntries = ({
  laneQueues,
  laneName,
  writeFsStrategy,
  ultraLightWriteThresholdBytes
}) => {
  const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
  if (!queue || !queue.length) return [];
  if (laneName === 'ultraLight' && writeFsStrategy?.microCoalescing) {
    const batch = selectMicroWriteBatch(queue, {
      maxEntries: writeFsStrategy.microBatchMaxCount,
      maxBytes: writeFsStrategy.microBatchMaxBytes,
      maxEntryBytes: ultraLightWriteThresholdBytes
    });
    return Array.isArray(batch?.entries) ? batch.entries.filter(Boolean) : [];
  }
  const entry = queue.shift();
  return entry ? [entry] : [];
};

export { DISPATCH_LANE_PRIORITY };
