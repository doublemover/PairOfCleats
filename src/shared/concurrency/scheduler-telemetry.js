/**
 * Normalize telemetry stage values.
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeTelemetryStage(value, fallback = 'init') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

/**
 * Append to a bounded list.
 * @param {Array<any>} list
 * @param {any} value
 * @param {number} maxCount
 */
export function appendBounded(list, value, maxCount) {
  list.push(value);
  while (list.length > maxCount) list.shift();
}

const cloneQueueDepthByName = (queuesByName = {}) => {
  const out = {};
  for (const [queueName, value] of Object.entries(queuesByName || {})) {
    out[queueName] = {
      pending: Number(value?.pending) || 0,
      pendingBytes: Number(value?.pendingBytes) || 0,
      running: Number(value?.running) || 0,
      inFlightBytes: Number(value?.inFlightBytes) || 0
    };
  }
  return out;
};

/**
 * Clone queue depth snapshots for external stats surfaces.
 * @param {Array<any>} entries
 * @returns {Array<any>}
 */
export const cloneQueueDepthEntries = (entries) => entries.map((entry) => {
  const queuesByName = {};
  for (const [queueName, value] of Object.entries(entry?.queues || {})) {
    queuesByName[queueName] = {
      pending: Number(value?.pending) || 0,
      pendingBytes: Number(value?.pendingBytes) || 0,
      running: Number(value?.running) || 0,
      inFlightBytes: Number(value?.inFlightBytes) || 0
    };
  }
  return {
    ...entry,
    pendingBytes: Number(entry?.pendingBytes) || 0,
    inFlightBytes: Number(entry?.inFlightBytes) || 0,
    queues: queuesByName
  };
});

/**
 * Clone scheduler trace entries for external stats surfaces.
 * @param {Array<any>} entries
 * @returns {Array<any>}
 */
export const cloneTraceEntries = (entries) => entries.map((entry) => ({
  ...entry,
  tokens: {
    cpu: { ...(entry?.tokens?.cpu || {}) },
    io: { ...(entry?.tokens?.io || {}) },
    mem: { ...(entry?.tokens?.mem || {}) }
  },
  activity: {
    pending: Number(entry?.activity?.pending) || 0,
    pendingBytes: Number(entry?.activity?.pendingBytes) || 0,
    running: Number(entry?.activity?.running) || 0,
    inFlightBytes: Number(entry?.activity?.inFlightBytes) || 0
  },
  queues: cloneQueueDepthByName(entry?.queues || {})
}));

/**
 * Clone adaptive decision entries for external stats surfaces.
 * @param {any} entry
 * @returns {any}
 */
export const cloneDecisionEntry = (entry) => ({
  ...(entry && typeof entry === 'object' ? entry : {}),
  snapshot: entry?.snapshot && typeof entry.snapshot === 'object'
    ? { ...entry.snapshot }
    : null,
  signals: entry?.signals && typeof entry.signals === 'object'
    ? {
      cpu: entry.signals.cpu && typeof entry.signals.cpu === 'object'
        ? { ...entry.signals.cpu }
        : null,
      memory: entry.signals.memory && typeof entry.signals.memory === 'object'
        ? { ...entry.signals.memory }
        : null
    }
    : null
});
