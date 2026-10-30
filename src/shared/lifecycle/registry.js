import { killChildProcessTree } from '../kill-tree.js';
import { awaitWithKeepalive } from '../promise-keepalive.js';

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
  if (Number.isFinite(Number(worker?.pid)) && typeof worker?.kill === 'function') {
    return () => killChildProcessTree(worker, {
      killTree: true,
      detached: Boolean(worker?.detached),
      graceMs: 0,
      awaitGrace: false
    }).catch(() => {});
  }
  const terminate = worker.terminate;
  if (typeof terminate === 'function') {
    return () => terminate.call(worker);
  }
  const kill = worker.kill;
  if (typeof kill === 'function') {
    return () => kill.call(worker, 'SIGTERM');
  }
  const close = worker.close;
  if (typeof close === 'function') {
    return () => close.call(worker);
  }
  return null;
};

const runLifecycleHooks = async (entries, hook, errors) => {
  for (const entry of entries) {
    if (!entry[hook]) continue;
    try {
      await entry[hook]();
    } catch (err) {
      errors.push(err);
    }
  }
};

const collectPendingErrors = async (pending, errors) => {
  if (!pending.size) return;
  const settled = await awaitWithKeepalive(Promise.allSettled(Array.from(pending)));
  for (const result of settled) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
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
  let closePromise = null;

  const reportError = (err) => {
    if (typeof onError !== 'function') return;
    try {
      Promise.resolve(onError(err)).catch(() => {});
    } catch {}
  };

  const register = (resource = null, { label = 'resource', close = null, drain = null } = {}) => {
    if (closed) {
      throw new Error(`[lifecycle] ${name} is closed; cannot register ${label}.`);
    }
    const originalClose = typeof close === 'function' ? close : resource?.close;
    const originalDrain = typeof drain === 'function' ? drain : resource?.drain;
    const closeHook = typeof originalClose === 'function'
      ? (typeof close === 'function' ? close : () => originalClose.call(resource)) : null;
    const drainHook = typeof originalDrain === 'function'
      ? (typeof drain === 'function' ? drain : () => originalDrain.call(resource)) : null;
    if (!closeHook && !drainHook) {
      throw new Error(`[lifecycle] ${name} ${label} must provide close or drain.`);
    }
    const entry = { label, close: closeHook, drain: drainHook };
    resources.add(entry);
    return () => {
      resources.delete(entry);
      if (entry.close) {
        try {
          const closeResult = entry.close();
          if (isPromiseLike(closeResult)) {
            closeResult.catch((err) => {
              reportError(err);
              return null;
            });
          }
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
    await runLifecycleHooks(Array.from(resources), 'drain', errors);
    await collectPendingErrors(pending, errors);
    const error = toLifecycleError(name, 'drain', errors);
    if (errors.length) throw error;
  };

  const close = () => {
    if (!closePromise) {
      closed = true;
      const entries = Array.from(resources).reverse();
      resources.clear();
      closePromise = Promise.resolve().then(async () => {
        const errors = [];
        await runLifecycleHooks(entries, 'close', errors);
        await runLifecycleHooks(entries, 'drain', errors);
        await collectPendingErrors(pending, errors);
        const error = toLifecycleError(name, 'close', errors);
        if (errors.length) throw error;
      });
      closePromise.catch(() => {});
    }
    return closePromise;
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
