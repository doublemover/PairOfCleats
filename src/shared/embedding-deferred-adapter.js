import { observeEmbeddingOwnership } from './embedding-cache-lifetime.js';
import { snapshotEmbeddingRequestArguments } from './embedding-selection-snapshot.js';

const closed = () => Object.assign(new Error('Embedding adapter lease is disposed.'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });

/** Preserve synchronous adapter construction while byte verification and native
 * acquisition remain awaited operations owned by the returned lease. */
export const createDeferredEmbeddingAdapter = ({ acquire, provider, methods }) => {
  let pending = null, adapter = null, disposed = false, disposing = null;
  let acquisitionObserver = null;
  const ensure = () => {
    if (disposed) return Promise.reject(closed());
    if (!pending) pending = Promise.resolve().then(acquire).then(value => { adapter = value; return value; }, error => {
      acquisitionObserver = observeEmbeddingOwnership(error); throw error;
    });
    return pending;
  };
  const target = {
    get provider() { return adapter?.provider || provider; },
    get supportsParallelDispatch() { return adapter?.supportsParallelDispatch === true; },
    executionInfo: () => adapter?.executionInfo?.() || { provider, requestedProvider: provider, loaded: false, loading: pending !== null, modelArtifact: null },
    get embedderPromise() { return ensure().then(value => { if (disposed) throw closed(); return value.embedderPromise; }); },
    dispose: () => {
      if (!disposing) {
        disposed = true;
        disposing = pending ? pending.then(value => value.dispose?.(), error => {
          const observe = acquisitionObserver || observeEmbeddingOwnership(error);
          if (observe && !observe()) throw error;
        }) : Promise.resolve();
        disposing = disposing.catch(error => { disposing = null; throw error; });
      }
      return disposing;
    }
  };
  for (const method of methods) target[method] = async (...args) => {
    const selected = snapshotEmbeddingRequestArguments(args);
    const value = await ensure();
    if (disposed) throw closed();
    if (typeof value[method] !== 'function') {
      if (['prewarm', 'endProfiling'].includes(method)) return undefined;
      throw new Error(`Embedding adapter does not support ${method}.`);
    }
    return value[method](...selected);
  };
  return new Proxy(target, { get(object, key, receiver) {
    if (Reflect.has(object, key)) return Reflect.get(object, key, receiver);
    return adapter ? Reflect.get(adapter, key, adapter) : undefined;
  } });
};
