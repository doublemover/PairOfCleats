import { resolveKillGraceMs, toNumber, toSafeArgList } from './options.js';
import { installTrackedSubprocessHooks } from './signals.js';
import {
  appendTrackedSubprocessEvent,
  entryMatchesOwnershipId,
  entryMatchesOwnershipPrefix,
  entryMatchesTrackedFilters,
  getTrackedSubprocessCount,
  normalizeTrackedOwnershipId,
  normalizeTrackedOwnershipPrefix,
  normalizeTrackedScope,
  removeTrackedSubprocess,
  resolveEntryOwnershipId,
  resetTrackedSubprocessEvents,
  resolveTrackedOwnershipId,
  resolveTrackedScope,
  snapshotTrackedSubprocessEvents,
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessEvents,
  trackedSubprocessScopeContext,
  trackedSubprocesses
} from './tracking-runtime.js';
import {
  terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync
} from './tracking-terminate.js';

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
const withTrackedSubprocessSignalScope = async (signal, scope, operation) => {
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

const createTrackedEntry = (child, options = {}) => ({
  child,
  killTree: options.killTree !== false,
  killSignal: options.killSignal || 'SIGTERM',
  killGraceMs: resolveKillGraceMs(options.killGraceMs),
  detached: options.detached === true,
  scope: options.scope,
  ownershipId: options.ownershipId,
  command: typeof options.command === 'string' ? options.command : null,
  args: toSafeArgList(options.args),
  name: typeof options.name === 'string' ? options.name : null,
  startedAtMs: toNumber(options.startedAtMs) || Date.now(),
  terminating: false,
  onClose: null
});

const registerChildProcessForCleanup = (child, options = {}) => {
  if (!child || !child.pid) {
    return () => {};
  }
  installTrackedSubprocessHooks(terminateTrackedSubprocesses, terminateTrackedSubprocessesSync);
  const entryKey = Symbol(`tracked-subprocess:${child.pid}`);
  const trackedScopeContext = trackedSubprocessScopeContext.getStore() || null;
  const abortSignal = options.signal && typeof options.signal === 'object'
    ? options.signal
    : null;
  const inheritedOwnershipId = normalizeTrackedOwnershipId(trackedOwnershipIdByAbortSignal.get(abortSignal))
    || normalizeTrackedOwnershipId(trackedScopeContext?.ownershipId ?? trackedScopeContext?.scope);
  const ownershipId = resolveTrackedOwnershipId(options) || inheritedOwnershipId || null;
  const scope = resolveTrackedScope(options) || ownershipId;
  const entry = createTrackedEntry(child, {
    ...options,
    scope,
    ownershipId
  });
  entry.onClose = () => {
    removeTrackedSubprocess(entryKey, 'close');
  };
  trackedSubprocesses.set(entryKey, entry);
  appendTrackedSubprocessEvent({
    kind: 'process_spawned',
    pid: child.pid,
    scope: entry.scope,
    ownershipId: entry.ownershipId,
    command: entry.command,
    args: entry.args,
    name: entry.name,
    reason: 'register'
  });
  child.once('close', entry.onClose);
  return () => {
    removeTrackedSubprocess(entryKey, 'unregister');
  };
};

export {
  trackedSubprocesses,
  trackedSubprocessEvents,
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext,
  normalizeTrackedOwnershipId,
  normalizeTrackedOwnershipPrefix,
  normalizeTrackedScope,
  resolveEntryOwnershipId,
  entryMatchesOwnershipId,
  entryMatchesOwnershipPrefix,
  entryMatchesTrackedFilters,
  withTrackedSubprocessSignalScope,
  terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync,
  registerChildProcessForCleanup,
  getTrackedSubprocessCount,
  snapshotTrackedSubprocessEvents,
  resetTrackedSubprocessEvents
};
