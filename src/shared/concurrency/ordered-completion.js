/**
 * Track completion promises and surface the first failure deterministically.
 *
 * This helper is designed for queue-driven pipelines where work dispatch may
 * await backpressure hooks instead of awaiting each completion promise.
 *
 * @returns {{
 *   track:(completion:Promise<unknown>|unknown,onSettled?:(()=>void)|null)=>Promise<unknown>|unknown,
 *   throwIfFailed:()=>void,
 *   wait:(options?:{
 *     stallPollMs?:number,
 *     timeoutMs?:number,
 *     signal?:AbortSignal|null,
 *     onStall?:(snapshot:{pending:number,failed:boolean,stallCount:number,elapsedMs:number})=>void
 *   })=>Promise<void>,
 *   snapshot:()=>{pending:number,failed:boolean}
 * }}
 */
export const createOrderedCompletionTracker = () => {
  const pending = new Set();
  let firstError = null;
  let drainPromise = null;
  let drainResolve = null;

  const resolveDrainIfIdle = () => {
    if (pending.size > 0 || typeof drainResolve !== 'function') return;
    const resolve = drainResolve;
    drainResolve = null;
    drainPromise = null;
    resolve();
  };

  /**
   * Track one completion promise and capture first rejection.
   *
   * @param {Promise<unknown>|unknown} completion
   * @param {(() => void)|null} [onSettled]
   * @returns {Promise<unknown>|unknown}
   */
  const track = (completion, onSettled = null) => {
    if (!completion || typeof completion.then !== 'function') return completion;
    pending.add(completion);
    const settle = completion
      .catch((err) => {
        if (!firstError) firstError = err;
      })
      .finally(() => {
        pending.delete(completion);
        if (typeof onSettled === 'function') onSettled();
        resolveDrainIfIdle();
      });
    void settle.catch(() => {});
    return completion;
  };

  /**
   * Throw first observed completion failure, if any.
   *
   * @returns {void}
   */
  const throwIfFailed = () => {
    if (firstError) throw firstError;
  };

  /**
   * Build deterministic timeout error for stalled ordered completion waits.
   *
   * @param {{timeoutMs:number,pending:number}} input
   * @returns {Error}
   */
  const createOrderedCompletionTimeoutError = ({ timeoutMs, pending }) => {
    const err = new Error(
      `Ordered completion wait timed out after ${timeoutMs}ms with ${pending} pending completion(s).`
    );
    err.code = 'ORDERED_COMPLETION_TIMEOUT';
    err.retryable = false;
    err.meta = {
      timeoutMs,
      pending
    };
    return err;
  };

  /**
   * Normalize abort-signal reason into an Error instance with deterministic code.
   *
   * @param {AbortSignal} signal
   * @returns {Error}
   */
  const createOrderedCompletionAbortError = (signal) => {
    const reason = signal?.reason;
    if (reason instanceof Error) return reason;
    const err = new Error('Ordered completion wait aborted.');
    err.code = 'ORDERED_COMPLETION_ABORTED';
    err.retryable = false;
    if (reason !== undefined) {
      err.meta = { reason };
    }
    return err;
  };

  /**
   * Wait for all tracked completions to settle and propagate first failure.
   *
   * The wait is optionally instrumented with periodic stall callbacks and can
   * be bounded by timeout/signal to prevent unbounded hangs.
   *
   * @param {{
   *   stallPollMs?:number,
   *   timeoutMs?:number,
   *   signal?:AbortSignal|null,
   *   onStall?:(snapshot:{pending:number,failed:boolean,stallCount:number,elapsedMs:number})=>void
   * }} [options]
   * @returns {Promise<void>}
   */
  const wait = async (options = {}) => {
    const stallPollMs = Number.isFinite(Number(options?.stallPollMs))
      ? Math.max(0, Math.floor(Number(options.stallPollMs)))
      : 0;
    const timeoutMs = Number.isFinite(Number(options?.timeoutMs))
      ? Math.max(0, Math.floor(Number(options.timeoutMs)))
      : 0;
    const signal = options?.signal && typeof options.signal.aborted === 'boolean'
      ? options.signal
      : null;
    const onStall = typeof options?.onStall === 'function'
      ? options.onStall
      : null;
    if (signal?.aborted) {
      throw createOrderedCompletionAbortError(signal);
    }
    if (pending.size > 0) {
      if (!drainPromise) {
        drainPromise = new Promise((resolve) => {
          drainResolve = resolve;
        });
      }
      const startMs = Date.now();
      let stallCount = 0;
      let timeoutId = null;
      let stallTimer = null;
      let abortHandler = null;
      let gateReject = null;
      const gate = new Promise((_, reject) => {
        gateReject = reject;
      });
      const cleanup = () => {
        if (timeoutId) {
          try { clearTimeout(timeoutId); } catch {}
          timeoutId = null;
        }
        if (stallTimer) {
          try { clearInterval(stallTimer); } catch {}
          stallTimer = null;
        }
        if (signal && abortHandler) {
          try { signal.removeEventListener('abort', abortHandler); } catch {}
          abortHandler = null;
        }
      };
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          const pendingCount = pending.size;
          gateReject?.(createOrderedCompletionTimeoutError({ timeoutMs, pending: pendingCount }));
        }, timeoutMs);
      }
      if (stallPollMs > 0 && onStall) {
        stallTimer = setInterval(() => {
          stallCount += 1;
          try {
            onStall({
              pending: pending.size,
              failed: Boolean(firstError),
              stallCount,
              elapsedMs: Math.max(0, Date.now() - startMs)
            });
          } catch {}
        }, stallPollMs);
      }
      if (signal) {
        abortHandler = () => {
          gateReject?.(createOrderedCompletionAbortError(signal));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      try {
        await Promise.race([drainPromise, gate]);
      } finally {
        cleanup();
      }
    }
    throwIfFailed();
  };

  /**
   * Snapshot current tracker state.
   *
   * @returns {{pending:number,failed:boolean}}
   */
  const snapshot = () => ({
    pending: pending.size,
    failed: Boolean(firstError)
  });

  return { track, throwIfFailed, wait, snapshot };
};
