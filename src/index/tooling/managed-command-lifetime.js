import path from 'node:path';
import { resolveManagedToolInstallation, retainManagedToolInstallation, retainManagedToolInstallationSync } from '../../shared/managed-installation.js';
import { resolveStorageLayout } from '../../shared/storage/layout.js';

const pendingInstallations = new Set();
const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_MANAGED_INSTALLATION' });

/** Identify only a command inside this application's managed install owner.
 * PATH/system tools keep their existing execution authority. A stale physical
 * generation inside the owner is an error, never an unmanaged fallback. */
export const resolveManagedCommandSelection = ({ toolingRoot, command }) => {
  if (!path.isAbsolute(command || '')) return null;
  toolingRoot ||= resolveStorageLayout().descriptors.tooling.path;
  const installs = path.join(path.resolve(toolingRoot), 'installs');
  const relative = path.relative(installs, path.resolve(command));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return null;
  const [toolId, directory, installId, ...filename] = relative.split(path.sep);
  if (!/^[a-z0-9][a-z0-9.-]{0,100}$/u.test(toolId || '') || directory !== 'generations'
    || !/^[a-f0-9]{64}$/u.test(installId || '') || !filename.length) throw fail('Command is not a canonical managed physical generation.');
  const selected = resolveManagedToolInstallation(toolingRoot, toolId);
  if (!selected || path.resolve(selected.command) !== path.resolve(command) || selected.installId !== installId) {
    throw fail('Managed command is stale, damaged or differs from the selected executable.');
  }
  return { toolingRoot: path.resolve(toolingRoot), toolId, descriptorId: selected.descriptorId,
    installId: selected.installId, command: selected.command };
};

/** The locator is not a lease. Acquire the canonical category/physical owner
 * leases and check the exact selected generation again before any spawn. */
export const retainManagedCommandInstallation = async options => {
  const selected = resolveManagedCommandSelection(options);
  if (!selected) return null;
  const held = await retainManagedToolInstallation(selected);
  return wrapRetainedInstallation(selected, held);
};

const wrapRetainedInstallation = (selected, held) => {
  if (held?.ok !== true || held.receipt?.installId !== selected.installId
    || held.receipt?.descriptorId !== selected.descriptorId || path.resolve(held.command || '') !== path.resolve(selected.command)) {
    held?.release?.();
    throw fail('Selected managed physical installation changed during runtime admission.');
  }
  let released = false;
  const lease = Object.freeze({ ...selected,
    assertHeld() { if (released) throw fail('Managed command installation was released before spawn.'); },
    releaseAfterSettlement(evidence) {
      if (released) return true;
      if (evidence?.settled !== true || evidence.pending === true) return false;
      if (held.release() !== true) throw Object.assign(fail('Managed command owner could not release its exact lease.'), { cacheOwnershipPending: true });
      released = true;
      pendingInstallations.delete(lease);
      return true;
    }
  });
  return lease;
};

export const runWithManagedCommandInstallationSync = (options, run) => {
  const selected = resolveManagedCommandSelection(options);
  if (!selected) return run();
  const lease = wrapRetainedInstallation(selected, retainManagedToolInstallationSync(selected));
  const reaped = value => value && (Number.isInteger(value.exitCode) || typeof value.signal === 'string' && value.signal.length > 0);
  try {
    lease.assertHeld();
    const value = run();
    if (!reaped(value)) throw Object.assign(fail('Managed sync subprocess returned without reaped child evidence.'), { cacheOwnershipPending: true });
    lease.releaseAfterSettlement({ settled: true, pending: false });
    return value;
  } catch (error) {
    // spawnSync returning normally with a status drains stdio and reaps its
    // direct child. Timeout/tree escalation has weaker evidence: retain it.
    const neverSpawned = error?.result?.pid === null && ['ENOENT', 'EACCES', 'ENOEXEC', 'EINVAL'].includes(error?.cause?.code);
    if (error?.code !== 'SUBPROCESS_TIMEOUT' && error?.cacheOwnershipPending !== true && (reaped(error?.result) || neverSpawned)) {
      lease.releaseAfterSettlement({ settled: true, pending: false });
    } else retainPendingManagedCommand(lease, error);
    throw error;
  }
};

export const retainPendingManagedCommand = (lease, error) => {
  if (!lease) return;
  pendingInstallations.add(lease);
  if (error && typeof error === 'object') {
    error.cacheOwnershipPending = true;
    error.managedCommandInstallation = { toolId: lease.toolId, descriptorId: lease.descriptorId,
      installId: lease.installId, command: lease.command, pending: true };
  }
};

/** Wrap the existing subprocess owner, retaining its lease until actual close
 * and any owner-reported tree cleanup settle. Timeout or cancellation alone
 * never release it. A delayed exact child close may reconcile a pending error. */
export const runWithManagedCommandInstallation = async (options, run) => {
  const lease = await retainManagedCommandInstallation(options);
  if (!lease) return run({ onSpawn: null });
  let child = null, closeObserved = false, invocationSettled = false, ownerSettlement = null;
  const reconcile = () => {
    const treeSettled = ownerSettlement === null || ownerSettlement() === true;
    if (!invocationSettled || !closeObserved || !treeSettled) return false;
    return lease.releaseAfterSettlement({ settled: true, pending: false });
  };
  const onSpawn = spawned => {
    child = spawned;
    child.once('close', () => {
      closeObserved = true;
      try { reconcile(); } catch (error) { retainPendingManagedCommand(lease, error); }
    });
  };
  try {
    lease.assertHeld();
    const value = await run({ onSpawn });
    invocationSettled = true;
    if (!reconcile()) {
      const error = Object.assign(fail('Managed subprocess returned without confirmed resource settlement.'), { cacheOwnershipPending: true });
      Object.defineProperty(error, 'cacheOwnershipReleased', { value: () => closeObserved });
      retainPendingManagedCommand(lease, error);
      throw error;
    }
    return value;
  } catch (error) {
    // Capture the subprocess owner's predicate before adding our own pending
    // marker. Our retained lease must not make a later actual close permanent.
    ownerSettlement = error?.cacheOwnershipPending === true
      ? typeof error.cacheOwnershipReleased === 'function' ? error.cacheOwnershipReleased : () => false
      : null;
    invocationSettled = true;
    if (!child || !reconcile()) retainPendingManagedCommand(lease, error);
    throw error;
  }
};
