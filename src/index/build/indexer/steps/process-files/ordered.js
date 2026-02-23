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
/**
 * Create an ordered result appender that preserves deterministic output order
 * while supporting concurrent shard/file execution.
 *
 * @param {(result:any,state:any,shardMeta:any)=>Promise<void>} handleFileResult
 * @param {any} state
 * @param {object} [options]
 * @returns {{
 *   enqueue:(orderIndex:number,result:any,shardMeta:any)=>Promise<void>,
 *   skip:(orderIndex:number)=>Promise<void>,
 *   peekNextIndex:()=>number,
 *   snapshot:()=>object,
 *   waitForCapacity:(input?:number|{orderIndex?:number,bypassWindow?:number})=>Promise<void>,
 *   abort:(err:any)=>void
 * }}
 */
export const buildOrderedAppender = (handleFileResult, state, options = {}) => {
  const debugOrdered = options.debugOrdered === true;
  const bucketSize = Number.isFinite(options.bucketSize)
    ? Math.max(0, Math.floor(options.bucketSize))
    : 0;
  const maxPendingBeforeBackpressure = Number.isFinite(options.maxPendingBeforeBackpressure)
    ? Math.max(1, Math.floor(options.maxPendingBeforeBackpressure))
    : 0;
  const maxPendingEmergencyFactor = Number.isFinite(Number(options.maxPendingEmergencyFactor))
    ? Math.max(1.25, Number(options.maxPendingEmergencyFactor))
    : 4;
  const maxPendingEmergency = maxPendingBeforeBackpressure > 0
    ? Math.max(
      maxPendingBeforeBackpressure + 1,
      Math.min(
        4096,
        Math.floor(maxPendingBeforeBackpressure * maxPendingEmergencyFactor)
      )
    )
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
  const capacityWaiters = new Set();
  let abortError = null;
  let lastActivityAt = Date.now();
  let emergencyCapacityActive = false;

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

  const hasUnseenExpectedWork = () => (
    expectedCount != null
    && seenCount < expectedCount
  );

  const shouldEnableEmergencyCapacity = () => {
    if (maxPendingBeforeBackpressure <= 0) return false;
    if (maxPendingEmergency <= maxPendingBeforeBackpressure) return false;
    if (!hasUnseenExpectedWork()) return false;
    if (pending.size <= maxPendingBeforeBackpressure) return false;
    if (emergencyCapacityActive) return true;
    if (stallMs <= 0) return false;
    return (Date.now() - lastActivityAt) >= stallMs;
  };

  const setEmergencyCapacityActive = (active, reason = null) => {
    if (emergencyCapacityActive === active) return;
    emergencyCapacityActive = active;
    const action = active ? 'enabled' : 'disabled';
    const reasonText = reason ? ` (${reason})` : '';
    emitLog(
      `[ordered] emergency capacity ${action}${reasonText}; pending=${pending.size}; limit=${maxPendingBeforeBackpressure}; emergencyLimit=${maxPendingEmergency}`,
      { kind: active ? 'warning' : 'status' }
    );
  };

  const refreshEmergencyCapacity = (reason = null) => {
    setEmergencyCapacityActive(shouldEnableEmergencyCapacity(), reason);
    return emergencyCapacityActive;
  };

  const noteAdvance = () => {
    const now = Date.now();
    lastAdvanceAt = now;
    lastActivityAt = now;
    setEmergencyCapacityActive(false, 'progress');
  };

  const noteActivity = () => {
    lastActivityAt = Date.now();
  };

  /**
   * Summarize smallest/largest pending indices without full-map sorting.
   *
   * @param {number} [limit=5]
   * @returns {{head:number[],tail:number[]}}
   */
  const collectPendingKeyWindow = (limit = 5) => {
    const size = Math.max(1, Math.floor(Number(limit) || 5));
    const minKeys = [];
    const maxKeys = [];
    const insertAsc = (arr, value) => {
      let inserted = false;
      for (let i = 0; i < arr.length; i += 1) {
        if (value < arr[i]) {
          arr.splice(i, 0, value);
          inserted = true;
          break;
        }
      }
      if (!inserted) arr.push(value);
      if (arr.length > size) arr.pop();
    };
    const insertDesc = (arr, value) => {
      let inserted = false;
      for (let i = 0; i < arr.length; i += 1) {
        if (value > arr[i]) {
          arr.splice(i, 0, value);
          inserted = true;
          break;
        }
      }
      if (!inserted) arr.push(value);
      if (arr.length > size) arr.pop();
    };
    for (const key of pending.keys()) {
      if (!Number.isFinite(key)) continue;
      insertAsc(minKeys, key);
      insertDesc(maxKeys, key);
    }
    return {
      head: minKeys,
      tail: maxKeys.slice().reverse()
    };
  };

  const rejectCapacityWaiters = (err) => {
    if (!capacityWaiters.size) return;
    const error = err instanceof Error ? err : new Error(String(err || 'Ordered appender aborted.'));
    const waiters = Array.from(capacityWaiters);
    capacityWaiters.clear();
    for (const waiter of waiters) {
      try {
        waiter.reject(error);
      } catch {}
    }
  };

  const resolveCapacityWaiters = () => {
    if (!capacityWaiters.size) return;
    if (aborted) {
      rejectCapacityWaiters(abortError || new Error('Ordered appender aborted.'));
      return;
    }
    const emergencyActive = refreshEmergencyCapacity('capacity-check');
    if (!emergencyActive) {
      const maxPendingAllowed = maxPendingBeforeBackpressure;
      if (maxPendingAllowed > 0 && pending.size > maxPendingAllowed) return;
    }
    const waiters = Array.from(capacityWaiters);
    capacityWaiters.clear();
    for (const waiter of waiters) {
      try {
        waiter.resolve();
      } catch {}
    }
  };

  /**
   * Await pending-buffer capacity before admitting more out-of-order results.
   *
   * @param {number|{orderIndex?:number,bypassWindow?:number}|null} [input]
   * @returns {Promise<void>}
   */
  const waitForCapacity = (input = null) => {
    let orderIndex = null;
    let bypassWindow = 0;
    if (Number.isFinite(input)) {
      orderIndex = Math.floor(Number(input));
    } else if (input && typeof input === 'object') {
      if (Number.isFinite(input.orderIndex)) {
        orderIndex = Math.floor(Number(input.orderIndex));
      }
      if (Number.isFinite(input.bypassWindow)) {
        bypassWindow = Math.max(0, Math.floor(Number(input.bypassWindow)));
      }
    }
    if (aborted) {
      return Promise.reject(abortError || new Error('Ordered appender aborted.'));
    }
    if (Number.isFinite(orderIndex) && orderIndex <= (nextIndex + bypassWindow)) {
      return Promise.resolve();
    }
    const emergencyActive = refreshEmergencyCapacity('wait');
    if (emergencyActive) {
      return Promise.resolve();
    }
    if (maxPendingBeforeBackpressure <= 0 || pending.size <= maxPendingBeforeBackpressure) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      capacityWaiters.add({ resolve, reject });
    });
  };

  /**
   * Emit periodic stall diagnostics when ordered progress cannot advance.
   *
   * @returns {void}
   */
  const scheduleStallCheck = () => {
    if (stallMs <= 0) return;
    if (stallTimer) return;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (!pending.size) {
        setEmergencyCapacityActive(false, 'drained');
        return;
      }
      refreshEmergencyCapacity('stall');
      resolveCapacityWaiters();
      if (!logFn) {
        scheduleStallCheck();
        return;
      }
      if (!pending.size) return;
      if (pending.has(nextIndex)) {
        scheduleStallCheck();
        return;
      }
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs < stallMs) {
        scheduleStallCheck();
        return;
      }
      const window = collectPendingKeyWindow(5);
      const head = window.head.join(', ');
      const tail = pending.size > window.head.length ? window.tail.join(', ') : '';
      const tailText = tail ? ` … ${tail}` : '';
      const idleSeconds = Math.round(idleMs / 1000);
      const seenRemaining = expectedCount != null ? Math.max(0, expectedCount - seenCount) : null;
      const completedCount = completed.size;
      const orderedRemaining = expectedCount != null ? Math.max(0, expectedCount - completedCount) : null;
      if (expectedCount != null && seenRemaining > 0) {
        emitLog(
          `[ordered] waiting on index ${nextIndex}; idle=${idleSeconds}s; pending=${pending.size}; ` +
          `unseen=${seenRemaining}; remaining=${orderedRemaining}; keys=${head}${tailText}`,
          { kind: 'status' }
        );
      } else {
        const remainingText = orderedRemaining != null ? `; remaining=${orderedRemaining}` : '';
        emitLog(
          `[ordered] stalled at index ${nextIndex} for ${idleSeconds}s; pending=${pending.size}${remainingText}; keys=${head}${tailText}`,
          { kind: 'warning' }
        );
      }
      scheduleStallCheck();
    }, stallMs);
    stallTimer.unref?.();
  };

  /**
   * Advance `nextIndex` across explicit skips and expected-order gaps.
   *
   * @returns {void}
   */
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

  /**
   * Fast-forward when all expected indices are seen but an index gap remains.
   *
   * @returns {void}
   */
  const maybeFinalize = () => {
    advancePastSkipped();
    if (expectedCount == null) return;
    if (seenCount < expectedCount) return;
    if (!pending.size) return;
    if (pending.has(nextIndex)) return;
    if (flushing) {
      flushRequested = true;
      return;
    }
    debugLog('[ordered] finalize reached expected count but nextIndex missing', {
      nextIndex,
      pending: pending.size,
      expectedCount,
      seenCount
    });
    let minPending = null;
    for (const key of pending.keys()) {
      if (!Number.isFinite(key) || key < nextIndex) continue;
      if (minPending == null || key < minPending) minPending = key;
    }
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

  /**
   * Abort ordered processing and reject all pending completions.
   *
   * @param {any} err
   * @returns {void}
   */
  const abort = (err) => {
    if (aborted) return;
    aborted = true;
    setEmergencyCapacityActive(false, 'abort');
    abortError = err instanceof Error ? err : new Error(String(err || 'Ordered appender aborted.'));
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    rejectCapacityWaiters(abortError);
    for (const entry of pending.values()) {
      try {
        entry?.reject?.(abortError);
      } catch {}
    }
    pending.clear();
  };

  /**
   * Flush any now-orderable pending results in deterministic index order.
   *
   * @returns {Promise<void>}
   */
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
          noteActivity();
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
      const currentIndex = nextIndex;
      const entry = pending.get(currentIndex);
      pending.delete(currentIndex);
      try {
        if (entry?.result) {
          await handleFileResult(entry.result, state, entry.shardMeta);
        }
        entry?.resolve?.();
      } catch (err) {
        try { entry?.reject?.(err); } catch {}
        throw err;
      } finally {
        completed.add(currentIndex);
        nextIndex = Math.max(nextIndex, currentIndex + 1);
        noteAdvance();
        advancePastSkipped();
        resolveCapacityWaiters();
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
    resolveCapacityWaiters();
  };

  /**
   * Serialize flush execution and coalesce concurrent flush requests.
   *
   * @returns {Promise<void>}
   */
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
        noteActivity();
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
      noteActivity();
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
      noteActivity();
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
        resolveCapacityWaiters();
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
    snapshot() {
      const keys = Array.from(pending.keys())
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      return {
        nextIndex,
        pendingCount: pending.size,
        pendingHead: keys.slice(0, 8),
        seenCount,
        expectedCount,
        completedCount: completed.size,
        maxPendingBeforeBackpressure,
        maxPendingEmergency,
        emergencyCapacityActive,
        lastAdvanceAt,
        lastActivityAt
      };
    },
    waitForCapacity,
    abort
  };
};
