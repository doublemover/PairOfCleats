export const createRowQueue = ({ maxPending = 0, onBackpressure = null, onResume = null } = {}) => {
  const buffer = [];
  const waiters = [];
  let drainResolver = null;
  let done = false;
  let error = null;
  let backpressured = false;
  const maxBuffer = Number.isFinite(maxPending) ? Math.max(0, maxPending) : 0;

  const resolveDrain = () => {
    if (!drainResolver) return;
    if (maxBuffer && buffer.length >= maxBuffer) return;
    const resolve = drainResolver;
    drainResolver = null;
    if (backpressured) {
      backpressured = false;
      if (typeof onResume === 'function') onResume(buffer.length);
    }
    resolve();
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
      if (!backpressured && typeof onBackpressure === 'function') {
        backpressured = true;
        onBackpressure(buffer.length);
      }
      await new Promise((resolve) => {
        drainResolver = resolve;
      });
    }
  };

  const finish = (err = null) => {
    if (done) return;
    done = true;
    error = err;
    if (drainResolver) {
      const resolve = drainResolver;
      drainResolver = null;
      resolve();
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
