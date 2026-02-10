const isPromiseLike = (value) => (
  value && typeof value.then === 'function'
);

const toLifecycleError = (name, stage, errors) => {
  if (!errors.length) return null;
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, `[lifecycle] ${name} ${stage} failed with ${errors.length} errors.`);
};

const resolveWorkerClose = (worker) => {
  if (!worker) return null;
  if (typeof worker.terminate === 'function') {
    return () => worker.terminate();
  }
  if (typeof worker.kill === 'function') {
    return () => worker.kill('SIGTERM');
  }
  if (typeof worker.close === 'function') {
    return () => worker.close();
  }
  return null;
};

/**
 * Create a lifecycle registry for timers/workers/promises.
 * Supports explicit register + drain + close.
 * @param {{name?:string,onError?:(err:any)=>void}} [options]
 */
export const createLifecycleRegistry = ({ name = 'lifecycle', onError = null } = {}) => {
  const resources = new Set();
  const pending = new Set();
  let closed = false;

  const reportError = (err) => {
    if (typeof onError !== 'function') return;
    try {
      onError(err);
    } catch {}
  };

  const register = (resource = null, { label = 'resource', close = null, drain = null } = {}) => {
    if (closed) {
      throw new Error(`[lifecycle] ${name} is closed; cannot register ${label}.`);
    }
    const closeHook = typeof close === 'function'
      ? close
      : (typeof resource?.close === 'function' ? () => resource.close() : null);
    const drainHook = typeof drain === 'function'
      ? drain
      : (typeof resource?.drain === 'function' ? () => resource.drain() : null);
    if (!closeHook && !drainHook) {
      throw new Error(`[lifecycle] ${name} ${label} must provide close or drain.`);
    }
    const entry = { label, close: closeHook, drain: drainHook };
    resources.add(entry);
    return () => {
      resources.delete(entry);
      if (entry.close) {
        try {
          entry.close();
        } catch (err) {
          reportError(err);
        }
      }
    };
  };

  const registerCleanup = (cleanup, { label = 'cleanup' } = {}) => register(null, {
    label,
    close: cleanup
  });

  const registerTimer = (timer, { label = 'timer' } = {}) => register(null, {
    label,
    close: () => {
      clearTimeout(timer);
      clearInterval(timer);
    }
  });

  const registerWorker = (worker, { label = 'worker', close = null, drain = null } = {}) => register(
    worker,
    {
      label,
      close: close || resolveWorkerClose(worker),
      drain
    }
  );

  const registerPromise = (promise, { label = 'promise' } = {}) => {
    if (!isPromiseLike(promise)) {
      return Promise.resolve(promise);
    }
    if (closed) {
      throw new Error(`[lifecycle] ${name} is closed; cannot register ${label}.`);
    }
    const tracked = Promise.resolve(promise);
    pending.add(tracked);
    tracked
      .catch((err) => {
        reportError(err);
        return null;
      })
      .finally(() => {
        pending.delete(tracked);
      });
    return tracked;
  };

  const drain = async () => {
    const errors = [];
    for (const entry of Array.from(resources)) {
      if (!entry.drain) continue;
      try {
        await entry.drain();
      } catch (err) {
        errors.push(err);
      }
    }
    if (pending.size) {
      const settled = await Promise.allSettled(Array.from(pending));
      for (const result of settled) {
        if (result.status === 'rejected') errors.push(result.reason);
      }
    }
    const error = toLifecycleError(name, 'drain', errors);
    if (error) throw error;
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    const errors = [];
    const entries = Array.from(resources).reverse();
    resources.clear();
    for (const entry of entries) {
      if (!entry.close) continue;
      try {
        await entry.close();
      } catch (err) {
        errors.push(err);
      }
    }
    try {
      await drain();
    } catch (err) {
      if (err instanceof AggregateError) {
        errors.push(...err.errors);
      } else {
        errors.push(err);
      }
    }
    const error = toLifecycleError(name, 'close', errors);
    if (error) throw error;
  };

  return {
    register,
    registerCleanup,
    registerTimer,
    registerWorker,
    registerPromise,
    drain,
    close,
    isClosed: () => closed,
    resourceCount: () => resources.size,
    pendingCount: () => pending.size
  };
};

