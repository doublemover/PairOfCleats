import {
  normalizeTrackedOwnershipId,
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext
} from './tracking-runtime.js';

/**
 * Bind a tracked-subprocess cleanup scope to an AbortSignal for the duration
 * of an async operation.
 *
 * Any subprocess created via `spawnSubprocess(...)` while the binding is
 * active will inherit this scope unless an explicit cleanup scope is provided.
 * When a shared `AbortSignal` is passed through, we also bind the signal so
 * out-of-context signal handlers can resolve the same scope.
 *
 * @template T
 * @param {AbortSignal|null|undefined} signal
 * @param {string|null|undefined} scope
 * @param {() => Promise<T>|T} operation
 * @returns {Promise<T>}
 */
export const withTrackedSubprocessSignalScope = async (signal, scope, operation) => {
  if (typeof operation !== 'function') {
    throw new TypeError('withTrackedSubprocessSignalScope requires an operation function.');
  }
  const ownershipId = normalizeTrackedOwnershipId(scope);
  if (!ownershipId) {
    return Promise.resolve().then(() => operation());
  }
  const bindSignal = signal && typeof signal === 'object';
  const previousOwnershipId = bindSignal
    ? normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(signal))
    : null;
  const runOperation = async () => {
    if (bindSignal) trackedOwnershipIdByAbortSignal.set(signal, ownershipId);
    try {
      return await operation();
    } finally {
      if (bindSignal) {
        if (previousOwnershipId) {
          trackedOwnershipIdByAbortSignal.set(signal, previousOwnershipId);
        } else {
          trackedOwnershipIdByAbortSignal.delete(signal);
        }
      }
    }
  };
  return trackedSubprocessScopeContext.run(
    { scope: ownershipId, ownershipId },
    runOperation
  );
};
