import { createAbortError, throwIfAborted } from '../abort.js';

/** One shared session admission owner, with optional bounded queued work. */
export const createRunQueue = ({ maxQueued = Infinity } = {}) => {
  const pending = [];
  const idle = new Set();
  let active = false;
  let closed = null;
  const capacity = Number.isFinite(maxQueued) ? Math.max(0, Math.floor(maxQueued)) : Infinity;
  const notifyIdle = () => {
    if (active || pending.length) return;
    for (const resolve of idle) resolve();
    idle.clear();
  };
  const pump = () => {
    if (active) return;
    const entry = pending.shift();
    if (!entry) { notifyIdle(); return; }
    entry.signal?.removeEventListener('abort', entry.onAbort);
    active = true;
    Promise.resolve().then(() => {
      throwIfAborted(entry.signal);
      return entry.runStep();
    }).then(value => {
      throwIfAborted(entry.signal);
      return value;
    }).then(entry.resolve, entry.reject).finally(() => {
      active = false;
      pump();
    });
  };
  const enqueue = (runStep, { signal } = {}) => {
    if (signal?.aborted) return Promise.reject(createAbortError());
    if (closed) return Promise.reject(closed);
    if (active && pending.length >= capacity) {
      return Promise.reject(Object.assign(new Error('Embedding inference admission queue is full.'), { code: 'ERR_EMBEDDING_QUEUE_FULL' }));
    }
    return new Promise((resolve, reject) => {
      const entry = { runStep, signal, resolve, reject, onAbort: null };
      entry.onAbort = () => {
        const index = pending.indexOf(entry);
        if (index < 0) return;
        pending.splice(index, 1);
        signal.removeEventListener('abort', entry.onAbort);
        reject(createAbortError());
        notifyIdle();
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      pending.push(entry);
      pump();
    });
  };
  enqueue.onIdle = () => !active && !pending.length ? Promise.resolve() : new Promise(resolve => idle.add(resolve));
  enqueue.close = () => {
    closed ||= Object.assign(new Error('Embedding session admission is closed.'), { code: 'ERR_EMBEDDING_QUEUE_CLOSED' });
    for (const entry of pending.splice(0)) {
      entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.reject(closed);
    }
    notifyIdle();
    return enqueue.onIdle();
  };
  return enqueue;
};
