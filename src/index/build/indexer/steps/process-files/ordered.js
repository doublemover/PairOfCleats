import { createTimeoutError, runWithTimeout } from '../../../../../shared/promise-timeout.js';

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
 * @param {(result:any,state:any,shardMeta:any,context?:{signal?:AbortSignal|null,orderIndex?:number|null,phase?:string})=>Promise<void>} handleFileResult
 * @param {any} state
 * @param {object} [options]
 * @returns {{
 *   enqueue:(orderIndex:number,result:any,shardMeta:any)=>Promise<void>,
 *   skip:(orderIndex:number)=>Promise<void>,
 *   recoverMissingRange:(input?:{start?:number,end?:number,reason?:string})=>{recovered:number,start:number|null,end:number|null,nextIndex:number},
 *   peekNextIndex:()=>number,
 *   snapshot:()=>object,
 *   waitForCapacity:(input?:number|{orderIndex?:number,bypassWindow?:number,signal?:AbortSignal|null,timeoutMs?:number,stallPollMs?:number,onStall?:(snapshot:object)=>void})=>Promise<void>,
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
  const flushTimeoutMs = Number.isFinite(options.flushTimeoutMs)
    ? Math.max(0, Math.floor(options.flushTimeoutMs))
    : 0;
  const flushAbortSignal = options.signal && typeof options.signal.aborted === 'boolean'
    ? options.signal
    : null;
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
  const capacityWaiters = [];
  let abortError = null;
  let lastActivityAt = Date.now();
  let emergencyCapacityActive = false;
  let flushActiveOrderIndex = null;
  let flushActivePhase = null;
  let flushActiveStartedAt = 0;

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
   * Build a deterministic timeout error for ordered flush writes.
   *
   * @param {{orderIndex:number,phase:string,timeoutMs:number}} input
   * @returns {Error}
   */
  const createOrderedFlushTimeoutError = ({ orderIndex, phase, timeoutMs }) => createTimeoutError({
    message: `Ordered flush timed out while writing index ${orderIndex} (${phase}) after ${timeoutMs}ms.`,
    code: 'ORDERED_FLUSH_TIMEOUT',
    retryable: false,
    meta: {
      orderIndex,
      phase,
      timeoutMs
    }
  });

  /**
   * Apply one ordered result payload with optional timeout guard and flush state.
   *
   * @param {any} entry
   * @param {number} orderIndex
   * @param {'late'|'ordered'} phase
   * @returns {Promise<void>}
   */
  const applyOrderedResult = async (entry, orderIndex, phase) => {
    if (!entry?.result) return;
    flushActiveOrderIndex = Number.isFinite(orderIndex) ? orderIndex : null;
    flushActivePhase = phase;
    flushActiveStartedAt = Date.now();
    try {
      await runWithTimeout(
        (signal) => handleFileResult(entry.result, state, entry.shardMeta, {
          signal,
          orderIndex: Number.isFinite(orderIndex) ? orderIndex : null,
          phase
        }),
        {
          timeoutMs: flushTimeoutMs,
          signal: flushAbortSignal,
          errorFactory: () => createOrderedFlushTimeoutError({
            orderIndex: Number.isFinite(orderIndex) ? orderIndex : -1,
            phase,
            timeoutMs: flushTimeoutMs
          })
        }
      );
    } finally {
      flushActiveOrderIndex = null;
      flushActivePhase = null;
      flushActiveStartedAt = 0;
    }
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

  const settleCapacityWaiter = (waiter, settle) => {
    if (!waiter || typeof waiter !== 'object') return;
    if (waiter.settled === true) return;
    waiter.settled = true;
    if (waiter.timeout) {
      try { clearTimeout(waiter.timeout); } catch {}
      waiter.timeout = null;
    }
    if (waiter.stallTimer) {
      try { clearInterval(waiter.stallTimer); } catch {}
      waiter.stallTimer = null;
    }
    if (waiter.signal && waiter.abortHandler) {
      try { waiter.signal.removeEventListener('abort', waiter.abortHandler); } catch {}
      waiter.abortHandler = null;
    }
    try {
      settle(waiter);
    } catch {}
  };
  const removeCapacityWaiter = (waiter) => {
    if (!waiter || !capacityWaiters.length) return;
    const idx = capacityWaiters.indexOf(waiter);
    if (idx >= 0) {
      capacityWaiters.splice(idx, 1);
    }
  };

  const rejectCapacityWaiters = (err) => {
    if (!capacityWaiters.length) return;
    const error = err instanceof Error ? err : new Error(String(err || 'Ordered appender aborted.'));
    for (let i = 0; i < capacityWaiters.length; i += 1) {
      const waiter = capacityWaiters[i];
      settleCapacityWaiter(waiter, (entry) => entry.reject(error));
    }
    capacityWaiters.length = 0;
  };

  const resolveCapacityWaiters = () => {
    if (!capacityWaiters.length) return;
    if (aborted) {
      rejectCapacityWaiters(abortError || new Error('Ordered appender aborted.'));
      return;
    }
    const emergencyActive = refreshEmergencyCapacity('capacity-check');
    const maxPendingAllowed = maxPendingBeforeBackpressure;
    const canAdmitByCapacity = emergencyActive
      || maxPendingAllowed <= 0
      || pending.size <= maxPendingAllowed;
    if (!canAdmitByCapacity) {
      let hasEligibleBypassWaiter = false;
      for (let i = 0; i < capacityWaiters.length; i += 1) {
        const waiter = capacityWaiters[i];
        if (waiter?.settled === true) continue;
        if (
          Number.isFinite(waiter?.orderIndex)
          && waiter.orderIndex <= (nextIndex + (waiter.bypassWindow || 0))
        ) {
          hasEligibleBypassWaiter = true;
          break;
        }
      }
      if (!hasEligibleBypassWaiter) return;
    }
    const unresolved = [];
    for (let i = 0; i < capacityWaiters.length; i += 1) {
      const waiter = capacityWaiters[i];
      if (waiter?.settled === true) continue;
      const withinBypassWindow = Number.isFinite(waiter?.orderIndex)
        && waiter.orderIndex <= (nextIndex + (waiter.bypassWindow || 0));
      if (canAdmitByCapacity || withinBypassWindow) {
        settleCapacityWaiter(waiter, (entry) => entry.resolve());
        continue;
      }
      unresolved.push(waiter);
    }
    capacityWaiters.length = 0;
    capacityWaiters.push(...unresolved);
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
    let signal = null;
    let timeoutMs = 0;
    let stallPollMs = 0;
    let onStall = null;
    if (Number.isFinite(input)) {
      orderIndex = Math.floor(Number(input));
    } else if (input && typeof input === 'object') {
      if (Number.isFinite(input.orderIndex)) {
        orderIndex = Math.floor(Number(input.orderIndex));
      }
      if (Number.isFinite(input.bypassWindow)) {
        bypassWindow = Math.max(0, Math.floor(Number(input.bypassWindow)));
      }
      if (input.signal && typeof input.signal.aborted === 'boolean') {
        signal = input.signal;
      }
      if (Number.isFinite(Number(input.timeoutMs))) {
        timeoutMs = Math.max(0, Math.floor(Number(input.timeoutMs)));
      }
      if (Number.isFinite(Number(input.stallPollMs))) {
        stallPollMs = Math.max(0, Math.floor(Number(input.stallPollMs)));
      }
      if (typeof input.onStall === 'function') {
        onStall = input.onStall;
      }
    }
    if (aborted) {
      return Promise.reject(abortError || new Error('Ordered appender aborted.'));
    }
    if (signal?.aborted) {
      const reason = signal.reason;
      return Promise.reject(
        reason instanceof Error
          ? reason
          : Object.assign(new Error('Ordered capacity wait aborted.'), {
            code: 'ORDERED_CAPACITY_WAIT_ABORTED',
            retryable: false,
            meta: { reason }
          })
      );
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
      const waiter = {
        resolve,
        reject,
        settled: false,
        timeout: null,
        stallTimer: null,
        signal,
        abortHandler: null,
        orderIndex,
        bypassWindow,
        startedAtMs: Date.now(),
        stallCount: 0
      };
      if (timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          const err = new Error(
            `Ordered capacity wait timed out after ${timeoutMs}ms (pending=${pending.size}, nextIndex=${nextIndex}).`
          );
          err.code = 'ORDERED_CAPACITY_WAIT_TIMEOUT';
          err.retryable = false;
          err.meta = {
            timeoutMs,
            pending: pending.size,
            nextIndex,
            orderIndex,
            bypassWindow
          };
          removeCapacityWaiter(waiter);
          settleCapacityWaiter(waiter, (entry) => entry.reject(err));
        }, timeoutMs);
      }
      if (signal) {
        waiter.abortHandler = () => {
          const reason = signal.reason;
          const err = reason instanceof Error
            ? reason
            : Object.assign(new Error('Ordered capacity wait aborted.'), {
              code: 'ORDERED_CAPACITY_WAIT_ABORTED',
              retryable: false,
              meta: { reason }
            });
          removeCapacityWaiter(waiter);
          settleCapacityWaiter(waiter, (entry) => entry.reject(err));
        };
        signal.addEventListener('abort', waiter.abortHandler, { once: true });
      }
      if (stallPollMs > 0 && onStall) {
        waiter.stallTimer = setInterval(() => {
          if (waiter.settled) return;
          waiter.stallCount += 1;
          try {
            onStall({
              stallCount: waiter.stallCount,
              elapsedMs: Math.max(0, Date.now() - waiter.startedAtMs),
              pending: pending.size,
              nextIndex,
              orderIndex,
              bypassWindow,
              snapshot: {
                nextIndex,
                pendingCount: pending.size,
                seenCount,
                expectedCount,
                maxPendingBeforeBackpressure,
                maxPendingEmergency,
                emergencyCapacityActive
              }
            });
          } catch {}
        }, stallPollMs);
        waiter.stallTimer.unref?.();
      }
      capacityWaiters.push(waiter);
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
          await applyOrderedResult(entry, key, 'late');
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
        await applyOrderedResult(entry, currentIndex, 'ordered');
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

  /**
   * Recover unresolved leading index gaps so ordered flush can continue.
   *
   * Defaults to recovering from `nextIndex` through the index before the
   * earliest pending entry. Callers may also pass explicit `start`/`end`.
   *
   * @param {{start?:number,end?:number,reason?:string}} [input]
   * @returns {{recovered:number,start:number|null,end:number|null,nextIndex:number}}
   */
  const recoverMissingRange = (input = {}) => {
    if (aborted) {
      return { recovered: 0, start: null, end: null, nextIndex };
    }
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    const explicitStart = Number.isFinite(input?.start) ? Math.floor(Number(input.start)) : null;
    const explicitEnd = Number.isFinite(input?.end) ? Math.floor(Number(input.end)) : null;
    let start = explicitStart != null ? explicitStart : nextIndex;
    if (start < nextIndex) start = nextIndex;
    let end = explicitEnd;
    if (end == null) {
      let minPending = null;
      for (const key of pending.keys()) {
        if (!Number.isFinite(key) || key < start) continue;
        if (minPending == null || key < minPending) minPending = key;
      }
      if (Number.isFinite(minPending) && minPending > start) {
        end = minPending - 1;
      } else {
        end = start - 1;
      }
    }
    if (!Number.isFinite(end) || end < start) {
      return { recovered: 0, start: null, end: null, nextIndex };
    }
    let recovered = 0;
    let recoveredStart = null;
    let recoveredEnd = null;
    for (let index = start; index <= end; index += 1) {
      const pendingEntry = pending.get(index);
      if (pendingEntry) {
        continue;
      }
      if (completed.has(index)) continue;
      noteSeen(index);
      skipped.add(index);
      if (recoveredStart == null) recoveredStart = index;
      recoveredEnd = index;
      recovered += 1;
    }
    if (recovered > 0) {
      noteActivity();
      const reasonText = reason ? ` (${reason})` : '';
      emitLog(`[ordered] recovered missing indices ${start}-${end}${reasonText}`, { kind: 'warning' });
      scheduleFlush().catch(() => {});
      scheduleStallCheck();
      maybeFinalize();
      resolveCapacityWaiters();
    }
    return {
      recovered,
      start: recoveredStart,
      end: recoveredEnd,
      nextIndex
    };
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
    recoverMissingRange,
    snapshot() {
      const keys = Array.from(pending.keys())
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      const flushActive = flushActiveStartedAt > 0
        ? {
          orderIndex: flushActiveOrderIndex,
          phase: flushActivePhase,
          startedAt: new Date(flushActiveStartedAt).toISOString(),
          elapsedMs: Math.max(0, Date.now() - flushActiveStartedAt)
        }
        : null;
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
        lastActivityAt,
        flushActive
      };
    },
    waitForCapacity,
    abort
  };
};
