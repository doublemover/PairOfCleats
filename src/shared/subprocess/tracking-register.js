import { resolveKillGraceMs, toNumber, toSafeArgList } from './options.js';
import { installTrackedSubprocessHooks } from './signals.js';
import {
  appendTrackedSubprocessEvent,
  normalizeTrackedOwnershipId,
  removeTrackedSubprocess,
  resolveTrackedOwnershipId,
  resolveTrackedScope,
  trackedOwnershipIdByAbortSignal,
  trackedSubprocessScopeContext,
  trackedSubprocesses
} from './tracking-runtime.js';
import {
  terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync
} from './tracking-terminate.js';

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

export const registerChildProcessForCleanup = (child, options = {}) => {
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
