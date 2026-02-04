// Ordered appender used to ensure deterministic chunk/doc ids regardless of
// concurrency and shard execution order.
//
// IMPORTANT: The original implementation returned the *flush attempt* promise.
// When an earlier file was slow, results from later files accumulated in
// `pending` until `nextIndex` advanced, creating unbounded buffering and
// eventual V8 OOMs that were highly timing-sensitive (e.g., "--inspect" would
// often avoid the crash).
//
// This version returns a promise that resolves only once the specific
// `orderIndex` has been flushed (i.e., processed in order). That creates
// backpressure via `runWithQueue`'s awaited `onResult`, bounding in-flight
// buffered results to queue concurrency.
export const buildOrderedAppender = (handleFileResult, state, options = {}) => {
  const pending = new Map();
  let nextIndex = 0;
  let flushing = null;
  let aborted = false;
  const skipped = new Set();
  const logFn = typeof options.log === 'function' ? options.log : null;
  const stallMs = Number.isFinite(options.stallMs) ? Math.max(0, options.stallMs) : 30000;
  let lastAdvanceAt = Date.now();
  let stallTimer = null;

  const emitLog = (message, meta) => {
    if (!logFn) return;
    try {
      if (logFn.length >= 2) logFn(message, meta);
      else logFn(message);
    } catch {}
  };

  const noteAdvance = () => {
    lastAdvanceAt = Date.now();
  };

  const scheduleStallCheck = () => {
    if (!logFn || stallMs <= 0) return;
    if (stallTimer) return;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (!pending.size) return;
      if (pending.has(nextIndex)) {
        scheduleStallCheck();
        return;
      }
      const ageMs = Date.now() - lastAdvanceAt;
      if (ageMs < stallMs) {
        scheduleStallCheck();
        return;
      }
      const keys = Array.from(pending.keys()).sort((a, b) => a - b);
      const head = keys.slice(0, 5).join(', ');
      const tail = keys.length > 5 ? keys.slice(-5).join(', ') : '';
      const tailText = tail ? ` … ${tail}` : '';
      emitLog(
        `[ordered] stalled at index ${nextIndex} for ${Math.round(ageMs / 1000)}s; pending=${pending.size}; keys=${head}${tailText}`,
        { kind: 'warning' }
      );
      scheduleStallCheck();
    }, stallMs);
    stallTimer.unref?.();
  };

  const advancePastSkipped = () => {
    while (skipped.has(nextIndex)) {
      skipped.delete(nextIndex);
      nextIndex += 1;
      noteAdvance();
    }
  };

  const abort = (err) => {
    if (aborted) return;
    aborted = true;
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    for (const entry of pending.values()) {
      try {
        entry?.reject?.(err);
      } catch {}
    }
    pending.clear();
  };

  const flush = async () => {
    advancePastSkipped();
    while (pending.has(nextIndex)) {
      const entry = pending.get(nextIndex);
      pending.delete(nextIndex);
      try {
        if (entry?.result) {
          await handleFileResult(entry.result, state, entry.shardMeta);
        }
        entry?.resolve?.();
      } catch (err) {
        try { entry?.reject?.(err); } catch {}
        throw err;
      } finally {
        nextIndex += 1;
        noteAdvance();
        advancePastSkipped();
      }
    }
  };

  const scheduleFlush = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        await flush();
      } catch (err) {
        abort(err);
        throw err;
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  return {
    enqueue(orderIndex, result, shardMeta) {
      if (aborted) {
        return Promise.reject(new Error('Ordered appender aborted.'));
      }
      if (Number.isFinite(orderIndex) && orderIndex < nextIndex) {
        return handleFileResult(result, state, shardMeta);
      }
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      if (pending.has(index)) {
        const existing = pending.get(index);
        if (result && !existing.result) existing.result = result;
        if (result && existing.result && existing.result !== result) existing.result = result;
        if (!existing.shardMeta && shardMeta) existing.shardMeta = shardMeta;
        scheduleFlush().catch(() => {});
        scheduleStallCheck();
        return existing.done;
      }
      let resolve;
      let reject;
      const done = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending.set(index, { result, shardMeta, resolve, reject, done });
      // Ensure rejections from the flush loop don't surface as unhandled.
      scheduleFlush().catch(() => {});
      scheduleStallCheck();
      return done;
    },
    skip(orderIndex) {
      if (aborted) return Promise.reject(new Error('Ordered appender aborted.'));
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      if (index < nextIndex) return Promise.resolve();
      if (pending.has(index)) {
        const entry = pending.get(index);
        pending.delete(index);
        try { entry?.resolve?.(); } catch {}
      }
      skipped.add(index);
      // Ensure we advance if the skipped index is next up.
      scheduleFlush().catch(() => {});
      scheduleStallCheck();
      return Promise.resolve();
    },
    abort
  };
};
