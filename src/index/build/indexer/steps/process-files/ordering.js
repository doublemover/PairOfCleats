import { compareStrings } from '../../../../../shared/sort.js';
import { normalizeOwnershipSegment } from '../../../../../shared/ownership-segment.js';

export { normalizeOwnershipSegment };

export const STAGE1_SEQ_STATE = Object.freeze({
  UNSEEN: 0,
  DISPATCHED: 1,
  IN_FLIGHT: 2,
  TERMINAL_SUCCESS: 3,
  TERMINAL_SKIP: 4,
  TERMINAL_FAIL: 5,
  TERMINAL_CANCEL: 6,
  COMMITTED: 7,
  UNUSED: 255
});

const TERMINAL_STATE_SET = new Set([
  STAGE1_SEQ_STATE.TERMINAL_SUCCESS,
  STAGE1_SEQ_STATE.TERMINAL_SKIP,
  STAGE1_SEQ_STATE.TERMINAL_FAIL,
  STAGE1_SEQ_STATE.TERMINAL_CANCEL
]);

/**
 * Resolve deterministic entry order index with compatibility fallbacks.
 *
 * @param {object} entry
 * @param {number|null} [fallbackIndex=null]
 * @returns {number|null}
 */
export const resolveEntryOrderIndex = (entry, fallbackIndex = null) => {
  if (Number.isFinite(entry?.orderIndex)) return Math.floor(entry.orderIndex);
  if (Number.isFinite(entry?.canonicalOrderIndex)) return Math.floor(entry.canonicalOrderIndex);
  if (Number.isFinite(fallbackIndex)) return Math.max(0, Math.floor(fallbackIndex));
  return null;
};

export const sortEntriesByOrderIndex = (entries) => {
  if (!Array.isArray(entries) || entries.length <= 1) {
    return Array.isArray(entries) ? entries : [];
  }
  const orderByIndex = new Array(entries.length);
  const indices = new Array(entries.length);
  for (let i = 0; i < entries.length; i += 1) {
    indices[i] = i;
    orderByIndex[i] = resolveEntryOrderIndex(entries[i], i);
  }
  indices.sort((a, b) => {
    const aOrder = Number.isFinite(orderByIndex[a]) ? orderByIndex[a] : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(orderByIndex[b]) ? orderByIndex[b] : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a - b;
  });
  const sorted = new Array(entries.length);
  for (let i = 0; i < indices.length; i += 1) {
    sorted[i] = entries[indices[i]];
  }
  return sorted;
};

const clampPositiveIntOr = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.floor(fallback);
  return Math.max(1, Math.floor(parsed));
};

const clampNonNegativeIntOr = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(parsed));
};

const clampPositiveNumberOr = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number(fallback);
  return parsed;
};

/**
 * Resolve Stage1 contiguous-window planner config from runtime inputs.
 *
 * @param {object|null} runtime
 * @returns {{
 *   targetWindowCost:number,
 *   maxWindowCost:number,
 *   maxWindowBytes:number,
 *   maxInFlightSeqSpan:number,
 *   minWindowEntries:number,
 *   maxWindowEntries:number,
 *   maxActiveWindows:number,
 *   adaptive:boolean,
 *   adaptiveShrinkFactor:number,
 *   adaptiveGrowFactor:number,
 *   commitLagSoft:number,
 *   bufferedBytesSoft:number
 * }}
 */
export const resolveStage1WindowPlannerConfig = (runtime = null) => {
  const windowConfig = runtime?.stage1Queues?.window && typeof runtime.stage1Queues.window === 'object'
    ? runtime.stage1Queues.window
    : {};
  const fileConcurrency = clampPositiveIntOr(runtime?.fileConcurrency, 1);
  const targetWindowCost = clampPositiveNumberOr(windowConfig.targetWindowCost, fileConcurrency * 500);
  const maxWindowCost = clampPositiveNumberOr(windowConfig.maxWindowCost, Math.max(targetWindowCost, targetWindowCost * 2));
  const maxWindowBytes = clampPositiveIntOr(windowConfig.maxWindowBytes, 64 * 1024 * 1024);
  const maxInFlightSeqSpan = clampPositiveIntOr(windowConfig.maxInFlightSeqSpan, Math.max(64, fileConcurrency * 32));
  const minWindowEntries = clampPositiveIntOr(windowConfig.minWindowEntries, Math.max(1, Math.min(16, fileConcurrency)));
  const maxWindowEntries = Math.max(
    minWindowEntries,
    clampPositiveIntOr(windowConfig.maxWindowEntries, Math.max(minWindowEntries, fileConcurrency * 64))
  );
  const maxActiveWindows = Math.min(
    2,
    Math.max(1, clampPositiveIntOr(windowConfig.maxActiveWindows, 2))
  );
  const adaptive = windowConfig.adaptive !== false;
  const adaptiveShrinkFactor = clampPositiveNumberOr(windowConfig.adaptiveShrinkFactor, 0.75);
  const adaptiveGrowFactor = clampPositiveNumberOr(windowConfig.adaptiveGrowFactor, 1.2);
  const commitLagSoft = clampNonNegativeIntOr(windowConfig.commitLagSoft, Math.max(16, fileConcurrency * 8));
  const bufferedBytesSoft = clampPositiveIntOr(windowConfig.bufferedBytesSoft, Math.floor(maxWindowBytes * 0.8));
  return {
    targetWindowCost,
    maxWindowCost,
    maxWindowBytes,
    maxInFlightSeqSpan,
    minWindowEntries,
    maxWindowEntries,
    maxActiveWindows,
    adaptive,
    adaptiveShrinkFactor,
    adaptiveGrowFactor,
    commitLagSoft,
    bufferedBytesSoft
  };
};

/**
 * Build deterministic contiguous Stage1 windows from ordered entries.
 *
 * @param {object[]} entries
 * @param {{
 *   config?:object,
 *   telemetrySnapshot?:{commitLag?:number,bufferedBytes?:number,computeUtilization?:number}
 * }} [input]
 * @returns {Array<{
 *   windowId:number,
 *   startSeq:number,
 *   endSeq:number,
 *   seqSpan:number,
 *   entryCount:number,
 *   predictedCost:number,
 *   predictedBytes:number,
 *   entries:object[]
 * }>}
 */
export const buildContiguousSeqWindows = (
  entries,
  {
    config = {},
    telemetrySnapshot = null
  } = {}
) => {
  const sortedEntries = sortEntriesByOrderIndex(entries);
  if (!sortedEntries.length) return [];

  const baseConfig = {
    targetWindowCost: clampPositiveNumberOr(config.targetWindowCost, 500),
    maxWindowCost: clampPositiveNumberOr(config.maxWindowCost, 1000),
    maxWindowBytes: clampPositiveIntOr(config.maxWindowBytes, 64 * 1024 * 1024),
    maxInFlightSeqSpan: clampPositiveIntOr(config.maxInFlightSeqSpan, 256),
    minWindowEntries: clampPositiveIntOr(config.minWindowEntries, 1),
    maxWindowEntries: clampPositiveIntOr(config.maxWindowEntries, 128),
    adaptive: config.adaptive !== false,
    adaptiveShrinkFactor: clampPositiveNumberOr(config.adaptiveShrinkFactor, 0.75),
    adaptiveGrowFactor: clampPositiveNumberOr(config.adaptiveGrowFactor, 1.2),
    commitLagSoft: clampNonNegativeIntOr(config.commitLagSoft, 64),
    bufferedBytesSoft: clampPositiveIntOr(config.bufferedBytesSoft, Math.floor(clampPositiveIntOr(config.maxWindowBytes, 64 * 1024 * 1024) * 0.8))
  };

  const commitLag = Number(telemetrySnapshot?.commitLag) || 0;
  const bufferedBytes = Number(telemetrySnapshot?.bufferedBytes) || 0;
  const computeUtilization = Number(telemetrySnapshot?.computeUtilization);
  let adaptiveFactor = 1;
  if (baseConfig.adaptive) {
    if (commitLag > baseConfig.commitLagSoft || bufferedBytes > baseConfig.bufferedBytesSoft) {
      adaptiveFactor = Math.min(1, Math.max(0.1, baseConfig.adaptiveShrinkFactor));
    } else if (Number.isFinite(computeUtilization) && computeUtilization < 0.55 && commitLag <= Math.max(1, Math.floor(baseConfig.commitLagSoft / 2))) {
      adaptiveFactor = Math.max(1, baseConfig.adaptiveGrowFactor);
    }
  }

  const effectiveTargetCost = Math.max(
    1,
    Math.min(baseConfig.maxWindowCost, baseConfig.targetWindowCost * adaptiveFactor)
  );

  const windows = [];
  let windowEntries = [];
  let windowStartSeq = null;
  let windowEndSeq = null;
  let windowCost = 0;
  let windowBytes = 0;

  const flushWindow = () => {
    if (!windowEntries.length || windowStartSeq == null || windowEndSeq == null) return;
    windows.push({
      windowId: windows.length,
      startSeq: windowStartSeq,
      endSeq: windowEndSeq,
      seqSpan: (windowEndSeq - windowStartSeq) + 1,
      entryCount: windowEntries.length,
      predictedCost: windowCost,
      predictedBytes: windowBytes,
      entries: windowEntries
    });
    windowEntries = [];
    windowStartSeq = null;
    windowEndSeq = null;
    windowCost = 0;
    windowBytes = 0;
  };

  for (let i = 0; i < sortedEntries.length; i += 1) {
    const entry = sortedEntries[i];
    const seq = resolveEntryOrderIndex(entry, i);
    if (!Number.isFinite(seq)) continue;
    const normalizedSeq = Math.floor(seq);
    const entryCost = Math.max(0, Number(entry?.costMs) || Number(entry?.lines) || 1);
    const entryBytes = Math.max(0, Math.floor(Number(entry?.bytes) || Number(entry?.size) || Number(entry?.stat?.size) || 0));

    if (windowStartSeq == null) {
      windowStartSeq = normalizedSeq;
      windowEndSeq = normalizedSeq;
      windowEntries = [entry];
      windowCost = entryCost;
      windowBytes = entryBytes;
      continue;
    }

    const nextSeqGap = normalizedSeq - windowEndSeq;
    const nextCount = windowEntries.length + 1;
    const nextCost = windowCost + entryCost;
    const nextBytes = windowBytes + entryBytes;
    const nextSpan = (normalizedSeq - windowStartSeq) + 1;

    const discontiguous = nextSeqGap !== 1;
    const exceedsEntryCap = nextCount > baseConfig.maxWindowEntries;
    const exceedsCostCap = nextCost > baseConfig.maxWindowCost;
    const exceedsTargetCost = windowEntries.length >= baseConfig.minWindowEntries && nextCost > effectiveTargetCost;
    const exceedsBytesCap = nextBytes > baseConfig.maxWindowBytes;
    const exceedsSpanCap = nextSpan > baseConfig.maxInFlightSeqSpan;

    if (discontiguous || exceedsEntryCap || exceedsCostCap || exceedsBytesCap || exceedsSpanCap || exceedsTargetCost) {
      flushWindow();
      windowStartSeq = normalizedSeq;
      windowEndSeq = normalizedSeq;
      windowEntries = [entry];
      windowCost = entryCost;
      windowBytes = entryBytes;
      continue;
    }

    windowEndSeq = normalizedSeq;
    windowEntries.push(entry);
    windowCost = nextCost;
    windowBytes = nextBytes;
  }

  flushWindow();
  return windows;
};

/**
 * Resolve the currently active window set for a commit cursor.
 *
 * @param {Array<object>} windows
 * @param {number} nextCommitSeq
 * @param {{maxActiveWindows?:number}} [input]
 * @returns {Array<object>}
 */
export const resolveActiveSeqWindows = (
  windows,
  nextCommitSeq,
  { maxActiveWindows = 2 } = {}
) => {
  const list = Array.isArray(windows) ? windows : [];
  if (!list.length) return [];
  const cursor = Number.isFinite(nextCommitSeq) ? Math.floor(nextCommitSeq) : list[0].startSeq;
  const activeLimit = Math.min(2, Math.max(1, clampPositiveIntOr(maxActiveWindows, 2)));
  let baseIndex = 0;
  for (let i = 0; i < list.length; i += 1) {
    const window = list[i];
    if (!Number.isFinite(window?.startSeq) || !Number.isFinite(window?.endSeq)) continue;
    if (cursor < window.startSeq) {
      baseIndex = i;
      break;
    }
    if (cursor >= window.startSeq && cursor <= window.endSeq) {
      baseIndex = i;
      break;
    }
    if (i === list.length - 1) {
      baseIndex = i;
    }
  }
  return list.slice(baseIndex, Math.min(list.length, baseIndex + activeLimit));
};

/**
 * Build fixed-size typed-array seq ledger for Stage1 runtime hot path.
 *
 * @param {{
 *   expectedSeqs?:number[],
 *   leaseTimeoutMs?:number
 * }} [input]
 * @returns {{
 *   states:Uint8Array,
 *   attempts:Uint16Array,
 *   leaseOwner:Int32Array,
 *   leaseHeartbeat:Float64Array,
 *   terminalReason:Int16Array,
 *   startSeq:number,
 *   endSeq:number,
 *   totalSeqCount:number,
 *   terminalCount:number,
 *   committedCount:number,
 *   inFlightCount:number,
 *   dispatchedCount:number,
 *   nextCommitSeq:number,
 *   toSlot:(seq:number)=>number,
 *   getState:(seq:number)=>number,
 *   assertLegalTransition:(seq:number,nextState:number)=>void,
 *   transition:(seq:number,nextState:number,input?:{ownerId?:number,reasonCode?:number,nowMs?:number})=>number,
 *   heartbeat:(seq:number,ownerId:number,nowMs?:number)=>boolean,
 *   reclaimExpiredLeases:(nowMs?:number)=>number[],
 *   snapshot:()=>object,
 *   assertCompletion:()=>void
 * }}
 */
export const createSeqLedger = ({ expectedSeqs = [], leaseTimeoutMs = 60000 } = {}) => {
  const orderedSeqs = Array.from(
    new Set(
      (Array.isArray(expectedSeqs) ? expectedSeqs : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.floor(value))
    )
  ).sort((a, b) => a - b);

  const startSeq = orderedSeqs.length ? orderedSeqs[0] : 0;
  const endSeq = orderedSeqs.length ? orderedSeqs[orderedSeqs.length - 1] : -1;
  const span = orderedSeqs.length ? (endSeq - startSeq + 1) : 0;
  const states = new Uint8Array(Math.max(0, span));
  states.fill(STAGE1_SEQ_STATE.UNUSED);
  const attempts = new Uint16Array(Math.max(0, span));
  const leaseOwner = new Int32Array(Math.max(0, span));
  const leaseHeartbeat = new Float64Array(Math.max(0, span));
  const terminalReason = new Int16Array(Math.max(0, span));

  for (const seq of orderedSeqs) {
    const slot = seq - startSeq;
    if (slot >= 0 && slot < states.length) {
      states[slot] = STAGE1_SEQ_STATE.UNSEEN;
      terminalReason[slot] = 0;
    }
  }

  const counters = {
    totalSeqCount: orderedSeqs.length,
    terminalCount: 0,
    committedCount: 0,
    inFlightCount: 0,
    dispatchedCount: 0,
    nextCommitSeq: orderedSeqs.length ? orderedSeqs[0] : 0
  };

  const leaseExpiryMs = clampPositiveIntOr(leaseTimeoutMs, 60000);

  const toSlot = (seq) => {
    const normalizedSeq = Number(seq);
    if (!Number.isFinite(normalizedSeq)) return -1;
    if (!orderedSeqs.length) return -1;
    const slot = Math.floor(normalizedSeq) - startSeq;
    if (slot < 0 || slot >= states.length) return -1;
    if (states[slot] === STAGE1_SEQ_STATE.UNUSED) return -1;
    return slot;
  };

  const getState = (seq) => {
    const slot = toSlot(seq);
    if (slot < 0) return STAGE1_SEQ_STATE.UNUSED;
    return states[slot];
  };

  const assertLegalTransition = (seq, nextState) => {
    const slot = toSlot(seq);
    if (slot < 0) {
      throw new Error(`Illegal seq transition for unknown seq=${seq}.`);
    }
    const prior = states[slot];
    const legal = (
      (prior === STAGE1_SEQ_STATE.UNSEEN && nextState === STAGE1_SEQ_STATE.DISPATCHED)
      || (prior === STAGE1_SEQ_STATE.DISPATCHED && nextState === STAGE1_SEQ_STATE.IN_FLIGHT)
      || (prior === STAGE1_SEQ_STATE.IN_FLIGHT && TERMINAL_STATE_SET.has(nextState))
      || (prior === STAGE1_SEQ_STATE.DISPATCHED && nextState === STAGE1_SEQ_STATE.TERMINAL_CANCEL)
      || (prior === STAGE1_SEQ_STATE.TERMINAL_FAIL && nextState === STAGE1_SEQ_STATE.DISPATCHED)
      || (TERMINAL_STATE_SET.has(prior) && nextState === STAGE1_SEQ_STATE.COMMITTED)
    );
    if (!legal) {
      const error = new Error(`Illegal Stage1 seq transition seq=${seq} prior=${prior} next=${nextState}.`);
      error.code = 'STAGE1_SEQ_ILLEGAL_TRANSITION';
      error.meta = { seq, prior, next: nextState };
      throw error;
    }
  };

  const transition = (seq, nextState, { ownerId = 0, reasonCode = 0, nowMs = Date.now() } = {}) => {
    const slot = toSlot(seq);
    if (slot < 0) {
      const error = new Error(`Unknown seq transition seq=${seq} next=${nextState}.`);
      error.code = 'STAGE1_SEQ_UNKNOWN';
      throw error;
    }
    assertLegalTransition(seq, nextState);
    const prior = states[slot];

    if (prior === STAGE1_SEQ_STATE.DISPATCHED) {
      counters.dispatchedCount = Math.max(0, counters.dispatchedCount - 1);
    }
    if (prior === STAGE1_SEQ_STATE.IN_FLIGHT) {
      counters.inFlightCount = Math.max(0, counters.inFlightCount - 1);
    }
    if (prior === STAGE1_SEQ_STATE.TERMINAL_FAIL && nextState === STAGE1_SEQ_STATE.DISPATCHED) {
      counters.terminalCount = Math.max(0, counters.terminalCount - 1);
    }

    states[slot] = nextState;

    if (nextState === STAGE1_SEQ_STATE.DISPATCHED) {
      counters.dispatchedCount += 1;
      attempts[slot] += 1;
      leaseOwner[slot] = Math.floor(Number(ownerId) || 0);
      leaseHeartbeat[slot] = Number.isFinite(nowMs) ? nowMs : Date.now();
      terminalReason[slot] = 0;
    } else if (nextState === STAGE1_SEQ_STATE.IN_FLIGHT) {
      counters.inFlightCount += 1;
      leaseOwner[slot] = Math.floor(Number(ownerId) || leaseOwner[slot] || 0);
      leaseHeartbeat[slot] = Number.isFinite(nowMs) ? nowMs : Date.now();
    } else if (TERMINAL_STATE_SET.has(nextState)) {
      counters.terminalCount += 1;
      leaseOwner[slot] = 0;
      leaseHeartbeat[slot] = 0;
      terminalReason[slot] = Math.floor(Number(reasonCode) || 0);
    } else if (nextState === STAGE1_SEQ_STATE.COMMITTED) {
      counters.committedCount += 1;
      const normalizedSeq = Math.floor(Number(seq));
      if (normalizedSeq === counters.nextCommitSeq) {
        counters.nextCommitSeq += 1;
      }
    }

    return nextState;
  };

  const heartbeat = (seq, ownerId, nowMs = Date.now()) => {
    const slot = toSlot(seq);
    if (slot < 0) return false;
    if (states[slot] !== STAGE1_SEQ_STATE.IN_FLIGHT) return false;
    const normalizedOwnerId = Math.floor(Number(ownerId) || 0);
    if (normalizedOwnerId > 0 && leaseOwner[slot] !== normalizedOwnerId) return false;
    leaseHeartbeat[slot] = Number.isFinite(nowMs) ? nowMs : Date.now();
    return true;
  };

  const reclaimExpiredLeases = (nowMs = Date.now()) => {
    const reclaimed = [];
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    for (let slot = 0; slot < states.length; slot += 1) {
      if (states[slot] !== STAGE1_SEQ_STATE.IN_FLIGHT) continue;
      const lastBeat = Number(leaseHeartbeat[slot]) || 0;
      if (lastBeat <= 0) continue;
      if ((now - lastBeat) < leaseExpiryMs) continue;
      const seq = startSeq + slot;
      transition(seq, STAGE1_SEQ_STATE.TERMINAL_FAIL, {
        reasonCode: 910,
        nowMs: now
      });
      reclaimed.push(seq);
    }
    return reclaimed;
  };

  const snapshot = () => ({
    startSeq,
    endSeq,
    totalSeqCount: counters.totalSeqCount,
    terminalCount: counters.terminalCount,
    committedCount: counters.committedCount,
    inFlightCount: counters.inFlightCount,
    dispatchedCount: counters.dispatchedCount,
    nextCommitSeq: counters.nextCommitSeq
  });

  const assertCompletion = () => {
    if (counters.totalSeqCount !== counters.terminalCount) {
      const err = new Error(
        `Stage1 seq terminal invariant failed: terminal=${counters.terminalCount} total=${counters.totalSeqCount}.`
      );
      err.code = 'STAGE1_SEQ_TERMINAL_INVARIANT';
      err.meta = snapshot();
      throw err;
    }
    if (counters.totalSeqCount !== counters.committedCount) {
      const err = new Error(
        `Stage1 seq commit invariant failed: committed=${counters.committedCount} total=${counters.totalSeqCount}.`
      );
      err.code = 'STAGE1_SEQ_COMMIT_INVARIANT';
      err.meta = snapshot();
      throw err;
    }
  };

  return {
    states,
    attempts,
    leaseOwner,
    leaseHeartbeat,
    terminalReason,
    startSeq,
    endSeq,
    totalSeqCount: counters.totalSeqCount,
    terminalCount: counters.terminalCount,
    committedCount: counters.committedCount,
    inFlightCount: counters.inFlightCount,
    dispatchedCount: counters.dispatchedCount,
    nextCommitSeq: counters.nextCommitSeq,
    toSlot,
    getState,
    assertLegalTransition,
    transition,
    heartbeat,
    reclaimExpiredLeases,
    snapshot,
    assertCompletion
  };
};

/**
 * Build stable shard subset id used for retries/merge-plan determinism.
 *
 * @param {object} workItem
 * @returns {string}
 */
export const resolveShardSubsetId = (workItem) => {
  const shardId = normalizeOwnershipSegment(
    String(workItem?.shard?.id || workItem?.shard?.label || 'unknown'),
    'unknown'
  );
  const partIndex = Number.isFinite(workItem?.partIndex)
    ? Math.max(1, Math.floor(workItem.partIndex))
    : 1;
  const partTotal = Number.isFinite(workItem?.partTotal)
    ? Math.max(partIndex, Math.floor(workItem.partTotal))
    : partIndex;
  return `${shardId}#${String(partIndex).padStart(4, '0')}/${String(partTotal).padStart(4, '0')}`;
};

/**
 * Resolve minimum order index represented by one shard work item.
 *
 * @param {object} workItem
 * @returns {number|null}
 */
export const resolveShardSubsetMinOrderIndex = (workItem) => {
  const list = Array.isArray(workItem?.entries) ? workItem.entries : [];
  let minIndex = null;
  for (let i = 0; i < list.length; i += 1) {
    const value = resolveEntryOrderIndex(list[i], i);
    if (!Number.isFinite(value)) continue;
    minIndex = minIndex == null ? value : Math.min(minIndex, value);
  }
  return Number.isFinite(minIndex) ? Math.floor(minIndex) : null;
};

/**
 * Resolve minimum order index represented by one shard work item.
 *
 * @param {object} workItem
 * @returns {number|null}
 */
export const resolveShardWorkItemMinOrderIndex = (workItem) => {
  const precomputed = Number(workItem?.firstOrderIndex);
  if (Number.isFinite(precomputed)) return Math.floor(precomputed);
  if (!workItem || typeof workItem !== 'object') return null;
  return resolveShardSubsetMinOrderIndex(workItem);
};

/**
 * Build deterministic merge order for sharded processing outputs.
 *
 * Primary sort key is minimum file order index, followed by shard id and part
 * metadata to guarantee stable merge ordering across runs.
 *
 * @param {object[]} [workItems=[]]
 * @returns {Array<{mergeIndex:number,subsetId:string,shardId:string|null,partIndex:number,partTotal:number,firstOrderIndex:number|null,fileCount:number}>}
 */
export const buildDeterministicShardMergePlan = (workItems = []) => {
  const list = Array.isArray(workItems)
    ? workItems.filter((workItem) => workItem && typeof workItem === 'object')
    : [];
  return list
    .map((workItem) => ({
      workItem,
      firstOrderIndex: resolveShardWorkItemMinOrderIndex(workItem)
    }))
    .sort((left, right) => {
      const aOrder = Number.isFinite(left.firstOrderIndex) ? left.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(right.firstOrderIndex) ? right.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aShard = String(left.workItem?.shard?.id || left.workItem?.shard?.label || '');
      const bShard = String(right.workItem?.shard?.id || right.workItem?.shard?.label || '');
      const shardCmp = compareStrings(aShard, bShard);
      if (shardCmp !== 0) return shardCmp;
      const aPartIndex = Number.isFinite(left.workItem?.partIndex) ? Math.floor(left.workItem.partIndex) : 1;
      const bPartIndex = Number.isFinite(right.workItem?.partIndex) ? Math.floor(right.workItem.partIndex) : 1;
      if (aPartIndex !== bPartIndex) return aPartIndex - bPartIndex;
      const aPartTotal = Number.isFinite(left.workItem?.partTotal) ? Math.floor(left.workItem.partTotal) : 1;
      const bPartTotal = Number.isFinite(right.workItem?.partTotal) ? Math.floor(right.workItem.partTotal) : 1;
      return aPartTotal - bPartTotal;
    })
    .map((entry, index) => {
      const workItem = entry.workItem;
      return {
        mergeIndex: index + 1,
        subsetId: resolveShardSubsetId(workItem),
        shardId: workItem?.shard?.id || null,
        partIndex: Number.isFinite(workItem?.partIndex) ? Math.floor(workItem.partIndex) : 1,
        partTotal: Number.isFinite(workItem?.partTotal) ? Math.floor(workItem.partTotal) : 1,
        firstOrderIndex: Number.isFinite(entry.firstOrderIndex)
          ? entry.firstOrderIndex
          : null,
        fileCount: Array.isArray(workItem?.entries) ? workItem.entries.length : 0
      };
    });
};

/**
 * Resolve per-subset retry policy for clustered shard execution.
 *
 * @param {object} runtime
 * @returns {{enabled:boolean,maxSubsetRetries:number,retryDelayMs:number}}
 */
export const resolveClusterSubsetRetryConfig = (runtime) => {
  const clusterConfig = runtime?.shards?.cluster && typeof runtime.shards.cluster === 'object'
    ? runtime.shards.cluster
    : {};
  const maxSubsetRetries = Number.isFinite(Number(clusterConfig.maxSubsetRetries))
    ? Math.max(0, Math.floor(Number(clusterConfig.maxSubsetRetries)))
    : (clusterConfig.enabled === true ? 1 : 0);
  const retryDelayMs = Number.isFinite(Number(clusterConfig.retryDelayMs))
    ? Math.max(0, Math.floor(Number(clusterConfig.retryDelayMs)))
    : 250;
  return {
    enabled: maxSubsetRetries > 0,
    maxSubsetRetries,
    retryDelayMs
  };
};

/**
 * Execute shard subsets sequentially with bounded retry policy.
 *
 * @param {{
 *  workItems?:object[],
 *  executeWorkItem:Function,
 *  maxSubsetRetries?:number,
 *  retryDelayMs?:number,
 *  onRetry?:Function|null,
 *  isRetryableError?:Function|null
 * }} [input]
 * @returns {Promise<{attemptsBySubset:Record<string,number>,retriedSubsetIds:string[],recoveredSubsetIds:string[]}>}
 */
export const runShardSubsetsWithRetry = async ({
  workItems,
  executeWorkItem,
  maxSubsetRetries = 0,
  retryDelayMs = 0,
  onRetry = null,
  isRetryableError = null
} = {}) => {
  const list = Array.isArray(workItems)
    ? workItems.filter((workItem) => workItem && typeof workItem === 'object')
    : [];
  if (typeof executeWorkItem !== 'function') {
    throw new TypeError('executeWorkItem must be a function');
  }
  const normalizedMaxRetries = Number.isFinite(Number(maxSubsetRetries))
    ? Math.max(0, Math.floor(Number(maxSubsetRetries)))
    : 0;
  const normalizedRetryDelayMs = Number.isFinite(Number(retryDelayMs))
    ? Math.max(0, Math.floor(Number(retryDelayMs)))
    : 0;
  const maxAttempts = normalizedMaxRetries + 1;
  const attemptsBySubset = new Map();
  const retriedSubsetIds = new Set();
  const recoveredSubsetIds = new Set();
  for (const workItem of list) {
    const subsetId = resolveShardSubsetId(workItem);
    let attempt = 0;
    while (true) {
      attempt += 1;
      attemptsBySubset.set(subsetId, attempt);
      try {
        await executeWorkItem(workItem, {
          subsetId,
          attempt,
          maxAttempts,
          isRetry: attempt > 1
        });
        if (attempt > 1) recoveredSubsetIds.add(subsetId);
        break;
      } catch (err) {
        const retryable = typeof isRetryableError === 'function'
          ? isRetryableError(err)
          : err?.retryable !== false;
        const hasAttemptsLeft = attempt < maxAttempts;
        if (!retryable || !hasAttemptsLeft) {
          if (err && typeof err === 'object') {
            if (!('shardSubsetId' in err)) err.shardSubsetId = subsetId;
            err.shardSubsetAttempt = attempt;
            err.shardSubsetMaxAttempts = maxAttempts;
          }
          throw err;
        }
        retriedSubsetIds.add(subsetId);
        if (typeof onRetry === 'function') {
          await onRetry({
            workItem,
            subsetId,
            attempt,
            maxAttempts,
            error: err
          });
        }
        if (normalizedRetryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, normalizedRetryDelayMs));
        }
      }
    }
  }
  return {
    attemptsBySubset: Object.fromEntries(attemptsBySubset.entries()),
    retriedSubsetIds: Array.from(retriedSubsetIds),
    recoveredSubsetIds: Array.from(recoveredSubsetIds)
  };
};
