export const recordSchedulerQueueWaitTime = (
  queue,
  waitedMs,
  {
    sampleLimit,
    resolvePercentile
  }
) => {
  if (!queue?.stats) return;
  const normalized = Math.max(0, Math.floor(Number(waitedMs) || 0));
  queue.stats.lastWaitMs = normalized;
  const samples = Array.isArray(queue.stats.waitSamples)
    ? queue.stats.waitSamples
    : [];
  if (samples.length < sampleLimit) {
    samples.push(normalized);
    queue.stats.waitSampleCursor = samples.length % sampleLimit;
  } else if (samples.length > 0) {
    const cursorRaw = Number.isFinite(Number(queue.stats.waitSampleCursor))
      ? Math.floor(Number(queue.stats.waitSampleCursor))
      : 0;
    const cursor = ((cursorRaw % samples.length) + samples.length) % samples.length;
    samples[cursor] = normalized;
    queue.stats.waitSampleCursor = (cursor + 1) % samples.length;
  }
  queue.stats.waitSamples = samples;
  queue.stats.waitP95Ms = resolvePercentile(samples, 0.95);
};

export const clearSchedulerQueue = (
  queue,
  {
    reason = 'scheduler queue cleared',
    normalizeByteCount,
    counters
  }
) => {
  if (!queue || !queue.pending.length) return 0;
  const error = new Error(reason);
  const cleared = queue.pending.splice(0, queue.pending.length);
  let clearedBytes = 0;
  for (const item of cleared) {
    if (typeof item?.detachAbort === 'function') {
      try {
        item.detachAbort();
      } catch {}
    }
    clearedBytes += normalizeByteCount(item?.bytes);
    queue.stats.rejected += 1;
    counters.rejected += 1;
    counters.rejectedByReason.cleared += 1;
    try {
      item.reject(error);
    } catch {}
  }
  queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - clearedBytes);
  return cleared.length;
};

export const clearAllSchedulerQueues = (queueOrder, clearQueue, reason = 'scheduler queue cleared') => {
  let cleared = 0;
  for (const queue of queueOrder) {
    cleared += clearQueue(queue.name, reason);
  }
  return cleared;
};
