/**
 * Track completion promises and surface the first failure deterministically.
 *
 * This helper is designed for queue-driven pipelines where work dispatch may
 * await backpressure hooks instead of awaiting each completion promise.
 *
 * @returns {{
 *   track:(completion:Promise<unknown>|unknown,onSettled?:(()=>void)|null)=>Promise<unknown>|unknown,
 *   throwIfFailed:()=>void,
 *   wait:()=>Promise<void>,
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
   * Wait for all tracked completions to settle and propagate first failure.
   *
   * @returns {Promise<void>}
   */
  const wait = async () => {
    if (pending.size > 0) {
      if (!drainPromise) {
        drainPromise = new Promise((resolve) => {
          drainResolve = resolve;
        });
      }
      await drainPromise;
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
