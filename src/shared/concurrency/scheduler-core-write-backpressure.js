import { normalizeQueueName } from './scheduler-core-normalize.js';

/**
 * Build write-backpressure policy config and mutable state.
 *
 * @param {object} input
 * @returns {{writeBackpressure:object,writeBackpressureState:object}}
 */
export const createWriteBackpressurePolicy = (input = {}) => {
  const writeBackpressureInput = input.writeBackpressure
    && typeof input.writeBackpressure === 'object'
    ? input.writeBackpressure
    : null;
  const writeBackpressure = {
    enabled: writeBackpressureInput?.enabled !== false,
    writeQueue: normalizeQueueName(writeBackpressureInput?.writeQueue) || 'stage2.write',
    producerQueues: new Set(
      Array.isArray(writeBackpressureInput?.producerQueues)
        ? writeBackpressureInput.producerQueues
          .map((entry) => normalizeQueueName(entry))
          .filter(Boolean)
        : ['stage1.cpu', 'stage1.io', 'stage1.postings', 'stage2.relations', 'stage2.relations.io']
    ),
    pendingThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingThreshold)))
      : 128,
    pendingBytesThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingBytesThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingBytesThreshold)))
      : (256 * 1024 * 1024),
    oldestWaitMsThreshold: Number.isFinite(Number(writeBackpressureInput?.oldestWaitMsThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.oldestWaitMsThreshold)))
      : 15000
  };
  const writeBackpressureState = {
    active: false,
    reasons: [],
    queue: writeBackpressure.writeQueue,
    pending: 0,
    pendingBytes: 0,
    oldestWaitMs: 0
  };
  return {
    writeBackpressure,
    writeBackpressureState
  };
};

/**
 * Reset mutable write-backpressure state to a non-active baseline.
 *
 * @param {object} writeBackpressureState
 * @returns {object}
 */
const clearWriteBackpressureState = (writeBackpressureState) => {
  writeBackpressureState.active = false;
  writeBackpressureState.reasons = [];
  writeBackpressureState.pending = 0;
  writeBackpressureState.pendingBytes = 0;
  writeBackpressureState.oldestWaitMs = 0;
  return writeBackpressureState;
};

/**
 * Evaluate write-backpressure state from current write-queue pressure signals.
 *
 * @param {{
 *   writeBackpressure:object,
 *   writeBackpressureState:object,
 *   queues:Map<string, any>,
 *   normalizeByteCount:(input:any)=>number,
 *   nowMs:()=>number
 * }} input
 * @returns {object}
 */
export const evaluateWriteBackpressureState = ({
  writeBackpressure,
  writeBackpressureState,
  queues,
  normalizeByteCount,
  nowMs
}) => {
  if (!writeBackpressure.enabled) {
    return clearWriteBackpressureState(writeBackpressureState);
  }
  const writeQueue = queues.get(writeBackpressure.writeQueue);
  if (!writeQueue) {
    return clearWriteBackpressureState(writeBackpressureState);
  }
  const pending = writeQueue.pending.length;
  const pendingBytes = normalizeByteCount(writeQueue.pendingBytes);
  const oldestWaitMs = pending > 0
    ? Math.max(0, nowMs() - Number(writeQueue.pending[0]?.enqueuedAt || nowMs()))
    : 0;
  const reasons = [];
  if (pending >= writeBackpressure.pendingThreshold) reasons.push('pending');
  if (pendingBytes >= writeBackpressure.pendingBytesThreshold) reasons.push('pendingBytes');
  if (oldestWaitMs >= writeBackpressure.oldestWaitMsThreshold) reasons.push('oldestWaitMs');
  writeBackpressureState.active = reasons.length > 0;
  writeBackpressureState.reasons = reasons;
  writeBackpressureState.pending = pending;
  writeBackpressureState.pendingBytes = pendingBytes;
  writeBackpressureState.oldestWaitMs = oldestWaitMs;
  return writeBackpressureState;
};
