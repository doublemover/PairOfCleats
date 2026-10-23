/**
 * @typedef {object} RowQueue
 * @property {(value:any)=>Promise<void>} push
 * @property {(err?:Error|null)=>void} finish
 * @property {(err?:Error|null)=>void} cancel
 * @property {() => AsyncGenerator<any, void, unknown>} iterator
 */

/**
 * Create a bounded async producer/consumer queue used by JSONL iterators.
 *
 * Invariants:
 * - `push()` blocks when `maxPending` is reached until a consumer drains.
 * - `finish(err)` ends iteration and rethrows `err` from the consumer side.
 * - `cancel()` aliases `finish()` so callers can stop producers in `finally`.
 *
 * @param {{
 *   maxPending?: number,
 *   onBackpressure?: ((pending:number) => void)|null,
 *   onResume?: ((pending:number) => void)|null
 * }} [options]
 * @returns {RowQueue}
 */
export const createRowQueue = ({ maxPending = 0, onBackpressure = null, onResume = null } = {}) => {
  const buffer = [];
  const waiters = [];
  const drainResolvers = [];
  let done = false;
  let error = null;
  let backpressured = false;
  const maxBuffer = Number.isFinite(maxPending) ? Math.max(0, maxPending) : 0;

  const resolveDrain = () => {
    if (!drainResolvers.length) return;
    if (maxBuffer && buffer.length >= maxBuffer) return;
    const resolvers = drainResolvers.splice(0, drainResolvers.length);
    try {
      if (backpressured) {
        backpressured = false;
        if (typeof onResume === 'function') onResume(buffer.length);
      }
    } finally {
      for (const resolve of resolvers) resolve();
    }
  };

  const push = async (value) => {
    if (done) return;
    if (waiters.length) {
      const waiter = waiters.shift();
      waiter({ value, done: false });
      return;
    }
    buffer.push(value);
    if (maxBuffer && buffer.length >= maxBuffer) {
      // Install the gate before a synchronous observer can cancel/finish the
      // queue. Otherwise cancellation resolves no gate and push waits forever.
      const draining = new Promise(resolve => drainResolvers.push(resolve));
      if (!backpressured && typeof onBackpressure === 'function') {
        backpressured = true;
        onBackpressure(buffer.length);
      }
      await draining;
    }
  };

  const finish = (err = null) => {
    if (done) return;
    done = true;
    error = err;
    if (drainResolvers.length) {
      const resolvers = drainResolvers.splice(0, drainResolvers.length);
      for (const resolve of resolvers) {
        resolve();
      }
    }
    while (waiters.length) {
      const waiter = waiters.shift();
      waiter({ value: undefined, done: true });
    }
  };

  const iterator = async function* () {
    while (true) {
      if (buffer.length) {
        const value = buffer.shift();
        resolveDrain();
        yield value;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      const result = await new Promise((resolve) => {
        waiters.push(resolve);
      });
      if (result.done) {
        if (error) throw error;
        return;
      }
      yield result.value;
    }
  };

  return { push, finish, cancel: finish, iterator };
};
