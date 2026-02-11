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
  const debugOrdered = options.debugOrdered === true;
  const bucketSize = Number.isFinite(options.bucketSize)
    ? Math.max(0, Math.floor(options.bucketSize))
    : 0;
  const pending = new Map();
  const completed = new Set();
  const startIndex = Number.isFinite(options.startIndex)
    ? Math.max(0, Math.floor(options.startIndex))
    : 0;
  let nextIndex = startIndex;
  let flushing = null;
  let aborted = false;
  let flushRequested = false;
  const skipped = new Set();
  const logFn = typeof options.log === 'function' ? options.log : null;
  const stallMs = Number.isFinite(options.stallMs) ? Math.max(0, options.stallMs) : 30000;
  let lastAdvanceAt = Date.now();
  let stallTimer = null;
  const expectedCount = Number.isFinite(options.expectedCount)
    ? Math.max(0, Math.floor(options.expectedCount))
    : null;
  const expectedOrder = Array.isArray(options.expectedIndices)
    ? Array.from(
      new Set(
        options.expectedIndices
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.floor(value))
      )
    ).sort((a, b) => a - b)
    : [];
  let expectedCursor = 0;
  while (expectedCursor < expectedOrder.length && expectedOrder[expectedCursor] < nextIndex) {
    expectedCursor += 1;
  }
  const seen = expectedCount != null ? new Set() : null;
  let seenCount = 0;

  const emitLog = (message, meta) => {
    if (!logFn) return;
    try {
      if (logFn.length >= 2) logFn(message, meta);
      else logFn(message);
    } catch {}
  };

  const debugLog = (message, details = null) => {
    if (!debugOrdered) return;
    let suffix = '';
    if (details && typeof details === 'object') {
      try {
        suffix = ` ${JSON.stringify(details)}`;
      } catch {
        suffix = ' [details=unserializable]';
      }
    }
    emitLog(`${message}${suffix}`, { kind: 'debug' });
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
    while (true) {
      let advanced = false;
      while (skipped.has(nextIndex)) {
        skipped.delete(nextIndex);
        completed.add(nextIndex);
        nextIndex += 1;
        noteAdvance();
        advanced = true;
      }
      while (expectedCursor < expectedOrder.length && expectedOrder[expectedCursor] < nextIndex) {
        expectedCursor += 1;
      }
      if (expectedOrder.length) {
        const nextExpected = expectedOrder[expectedCursor];
        if (Number.isFinite(nextExpected) && nextExpected > nextIndex) {
          let minPending = null;
          if (pending.size) {
            for (const key of pending.keys()) {
              if (!Number.isFinite(key) || key < nextIndex) continue;
              if (minPending == null || key < minPending) minPending = key;
            }
          }
          if (Number.isFinite(minPending) && minPending < nextExpected) {
            if (minPending > nextIndex) {
              debugLog('[ordered] advancing to earliest pending index before expected gap', {
                from: nextIndex,
                to: minPending,
                nextExpected
              });
              nextIndex = minPending;
              noteAdvance();
              advanced = true;
              continue;
            }
            if (minPending === nextIndex) break;
          }
          debugLog('[ordered] implicit gap skip', {
            from: nextIndex,
            to: nextExpected
          });
          nextIndex = nextExpected;
          noteAdvance();
          advanced = true;
          continue;
        }
      }
      if (!advanced) break;
    }
  };

  const maybeFinalize = () => {
    advancePastSkipped();
    if (expectedCount == null) return;
    if (seenCount < expectedCount) return;
    if (!pending.size) return;
    if (pending.has(nextIndex)) return;
    debugLog('[ordered] finalize reached expected count but nextIndex missing', {
      nextIndex,
      pending: pending.size,
      expectedCount,
      seenCount
    });
    const keys = Array.from(pending.keys()).sort((a, b) => a - b);
    const minPending = keys[0];
    if (!Number.isFinite(minPending) || minPending <= nextIndex) return;
    let expectedMissing = true;
    if (expectedOrder.length) {
      expectedMissing = false;
      for (let i = expectedCursor; i < expectedOrder.length; i += 1) {
        const candidate = expectedOrder[i];
        if (candidate < nextIndex) continue;
        if (candidate >= minPending) break;
        if (seen?.has(candidate) || skipped.has(candidate) || pending.has(candidate)) continue;
        expectedMissing = true;
        break;
      }
    }
    if (expectedMissing) {
      emitLog(
        `[ordered] missing indices ${nextIndex}-${minPending - 1}; fast-forwarding to ${minPending}`,
        { kind: 'warning' }
      );
    } else {
      debugLog('[ordered] fast-forward across implicit index gap', {
        from: nextIndex,
        to: minPending
      });
    }
    nextIndex = minPending;
    noteAdvance();
    scheduleFlush().catch(() => {});
  };

  const noteSeen = (index) => {
    if (!seen) return;
    if (!Number.isFinite(index)) return;
    if (seen.has(index)) return;
    seen.add(index);
    seenCount += 1;
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
    debugLog('[ordered] flush start', {
      nextIndex,
      pending: pending.size,
      expectedCount,
      seenCount
    });
    advancePastSkipped();
    if (pending.size) {
      const outOfOrder = Array.from(pending.keys())
        .filter((key) => Number.isFinite(key) && key < nextIndex)
        .sort((a, b) => a - b);
      if (outOfOrder.length) {
        emitLog(
          `[ordered] flushing ${outOfOrder.length} late index(es) < ${nextIndex}: ${outOfOrder.slice(0, 5).join(', ')}${outOfOrder.length > 5 ? ' …' : ''}`,
          { kind: 'warning' }
        );
      }
      for (const key of outOfOrder) {
        const entry = pending.get(key);
        pending.delete(key);
        if (completed.has(key)) {
          emitLog(`[ordered] dropping duplicate late result index ${key}`, { kind: 'warning' });
          entry?.resolve?.();
          continue;
        }
        try {
          if (entry?.result) {
            await handleFileResult(entry.result, state, entry.shardMeta);
          }
          completed.add(key);
          entry?.resolve?.();
        } catch (err) {
          try { entry?.reject?.(err); } catch {}
          throw err;
        }
      }
    }
    const bucketUpperBound = bucketSize > 0
      ? (Math.floor(nextIndex / bucketSize) + 1) * bucketSize
      : Number.POSITIVE_INFINITY;
    while (pending.has(nextIndex) && nextIndex < bucketUpperBound) {
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
        completed.add(nextIndex);
        nextIndex += 1;
        noteAdvance();
        advancePastSkipped();
      }
    }
    if (bucketSize > 0 && pending.has(nextIndex)) {
      debugLog('[ordered] bucket watermark yield', {
        nextIndex,
        bucketUpperBound,
        pending: pending.size
      });
      flushRequested = true;
    }
    debugLog('[ordered] flush complete', {
      nextIndex,
      pending: pending.size,
      expectedCount,
      seenCount,
      bucketSize
    });
  };

  const scheduleFlush = async () => {
    if (flushing) {
      flushRequested = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        await flush();
      } catch (err) {
        abort(err);
        throw err;
      } finally {
        flushing = null;
        if (flushRequested && !aborted) {
          flushRequested = false;
          // Schedule another pass for entries queued while we were flushing.
          scheduleFlush().catch(() => {});
        }
      }
    })();
    return flushing;
  };

  return {
    enqueue(orderIndex, result, shardMeta) {
      if (aborted) {
        return Promise.reject(new Error('Ordered appender aborted.'));
      }
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      if (skipped.has(index)) {
        skipped.delete(index);
      }
      if (Number.isFinite(orderIndex) && orderIndex < nextIndex) {
        noteSeen(orderIndex);
        if (completed.has(orderIndex)) {
          emitLog(`[ordered] dropping duplicate stale result index ${orderIndex}`, { kind: 'warning' });
          return Promise.resolve();
        }
        debugLog('[ordered] enqueue late', {
          orderIndex,
          nextIndex,
          pending: pending.size,
          expectedCount,
          seenCount
        });
      }
      noteSeen(index);
      if (pending.has(index)) {
        const existing = pending.get(index);
        if (result && !existing.result) existing.result = result;
        if (result && existing.result && existing.result !== result) existing.result = result;
        if (!existing.shardMeta && shardMeta) existing.shardMeta = shardMeta;
        debugLog('[ordered] enqueue merge', {
          orderIndex,
          index,
          nextIndex,
          pending: pending.size,
          expectedCount,
          seenCount
        });
        scheduleFlush().catch(() => {});
        scheduleStallCheck();
        maybeFinalize();
        return existing.done;
      }
      let resolve;
      let reject;
      const done = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending.set(index, { result, shardMeta, resolve, reject, done });
      debugLog('[ordered] enqueue new', {
        orderIndex,
        index,
        nextIndex,
        pending: pending.size,
        expectedCount,
        seenCount
      });
      // Ensure rejections from the flush loop don't surface as unhandled.
      scheduleFlush().catch(() => {});
      scheduleStallCheck();
      maybeFinalize();
      return done;
    },
    skip(orderIndex) {
      if (aborted) return Promise.reject(new Error('Ordered appender aborted.'));
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      if (index < nextIndex) {
        completed.add(index);
        return Promise.resolve();
      }
      noteSeen(index);
      debugLog('[ordered] skip', {
        orderIndex,
        index,
        nextIndex,
        pending: pending.size,
        expectedCount,
        seenCount
      });
      if (pending.has(index)) {
        const entry = pending.get(index);
        pending.delete(index);
        try { entry?.resolve?.(); } catch {}
        completed.add(index);
      }
      skipped.add(index);
      // Ensure we advance if the skipped index is next up.
      scheduleFlush().catch(() => {});
      scheduleStallCheck();
      maybeFinalize();
      return Promise.resolve();
    },
    peekNextIndex() {
      return nextIndex;
    },
    abort
  };
};
