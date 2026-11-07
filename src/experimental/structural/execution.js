// Source UNVALIDATED: actual shared subprocess closure governs installation release.
import path from 'node:path';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { retainManagedToolInstallation } from '../../shared/managed-installation.js';
import { isStorageSessionReleaseFailure } from '../../shared/storage/session.js';
import { spawnResolvedSubprocess } from '../../shared/subprocess/command-invocation.js';
import { locateToolExecutable, resolveToolsById } from '../../../tools/tooling/utils.js';
import { identifyProvisioningExecutable } from '../../../tools/tooling/provisioning-plan.js';
import { verifyStructuralBinaryIdentity } from './binaries.js';

const missing = engine => Object.assign(new Error(`${engine} has no identified structural engine executable. Select it in tooling setup.`), { code: 'ENOENT' });
const sameExecutable = (actual, expected) => actual.path === expected.path && actual.sha256 === expected.sha256 && actual.size === expected.size;
const changedExecutable = () => Object.assign(new Error('Structural executable identity changed after admission.'), { code: 'ERR_STRUCTURAL_EXECUTABLE_CHANGED' });

/** Hold exact selected generation through identity probe and every rule child.
 * Injection is for source fixtures, not a user supplied execution/authority knob.
 */
export const withStructuralBinary = async (engine, { repoRoot, signal = null } = {}, execute, dependencies = {}) => {
  const config = (dependencies.getConfig || getToolingConfig)(repoRoot);
  const tool = (dependencies.resolveTools || resolveToolsById)([engine], config.dir, repoRoot, config)[0];
  if (!tool) throw missing(engine);
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) throw missing(engine);
  let held = null;
  let pendingError = null;
  let primaryError = null;
  let firstFailure = null, selectedInstallId = null, selectedRoot = null, released = false, scopeClosed = false, observerOverflow = false;
  const invocations = new Set(), observers = [], observed = new WeakSet(), described = new WeakSet(), ownedMetadataFailures = new WeakSet();
  const observePending = error => {
    if (!error || typeof error !== 'object' || observed.has(error) || described.has(error) || ownedMetadataFailures.has(error)) return null;
    observed.add(error);
    let observer = null;
    try {
      const original = error.cacheOwnershipReleased;
      if (error.cacheOwnershipPending === true || typeof original === 'function') observer = () => {
        try { return typeof original === 'function' && original.call(error) === true; } catch { return false; }
      };
    } catch { observer = () => false; }
    if (observer) {
      if (observers.length < 128) observers.push(observer);
      else observerOverflow = true;
    }
    return observer;
  };
  const settled = () => {
    try { return !observerOverflow && [...invocations].every(invocation => invocation.finished && invocation.closed()) && observers.every(observe => observe()); }
    catch { return false; }
  };
  const release = () => {
    if (!settled()) throw Object.assign(new Error('Actual structural child/tree closure remains pending.'), { code: 'ERR_STRUCTURAL_PENDING' });
    if (released) return true;
    if (held) {
      let confirmed;
      try { confirmed = held.release(); }
      catch (error) {
        if (isStorageSessionReleaseFailure(error, held.storageSession)) ownedMetadataFailures.add(error);
        throw error;
      }
      if (confirmed !== true) throw Object.assign(new Error('Structural managed installation lease changed before release.'), { code: 'ERR_STRUCTURAL_RELEASE' });
    }
    held = null;
    released = true;
    return true;
  };
  const session = Object.freeze({ get installId() { return selectedInstallId; }, get root() { return selectedRoot; },
    releaseAfterClosure: () => {
      try { return release(); }
      catch (error) { observePending(error); throw retainFailure(firstFailure || error, error); }
    } });
  const retainFailure = (value, secondary = null) => {
    const error = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
    firstFailure ||= error;
    const additional = secondary && secondary !== error ? secondary : null;
    const descriptors = {
      cacheOwnershipPending: { value: true, configurable: true },
      cacheOwnershipReleased: { value: () => released && settled(), configurable: true },
      structuralInstallationSession: { value: session, configurable: true },
      ...(additional ? { structuralReleaseError: { value: additional, configurable: true } } : {})
    };
    try {
      if (Object.hasOwn(error, 'structuralInstallationSession')) throw new Error('Keep the original structural owner on its exact cause.');
      Object.defineProperties(error, descriptors);
      described.add(error);
      return error;
    } catch {
      const aggregate = new AggregateError([error, ...(additional ? [additional] : [])], error.message, { cause: error });
      const existing = Object.getOwnPropertyDescriptors(error);
      for (const key of Reflect.ownKeys(existing)) {
        if (['cause', 'errors', 'message', 'stack'].includes(key) || Object.hasOwn(descriptors, key)) continue;
        Object.defineProperty(aggregate, key, existing[key]);
      }
      Object.defineProperties(aggregate, descriptors);
      described.add(aggregate);
      return aggregate;
    }
  };
  try {
    signal?.throwIfAborted();
    if (tool.managedInstallation) {
      held = await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: config.dir, toolId: engine,
        descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId });
      selectedInstallId = held.receipt.installId;
      selectedRoot = held.root;
      if (held.receipt.installId !== tool.managedInstallation.installId) throw new Error('Structural physical installation changed before execution.');
    }
    const candidate = held?.command || located.path;
    const prefix = held?.args || tool.managedInstallation?.args || [];
    const identify = dependencies.identify || identifyProvisioningExecutable;
    const selectedBytes = identify(candidate, { signal });
    const command = selectedBytes.path;
    if (typeof command !== 'string' || !path.isAbsolute(command) || !/^[a-f0-9]{64}$/.test(selectedBytes.sha256 || '')
      || !Number.isSafeInteger(selectedBytes.size) || selectedBytes.size < 0) throw new Error('Structural executable identity is incomplete.');
    const spawn = dependencies.spawn || spawnResolvedSubprocess;
    const run = async (args, options = {}) => {
      signal?.throwIfAborted();
      if (pendingError) throw pendingError;
      if (released || scopeClosed) throw new Error('Structural execution scope has already closed.');
      if (!sameExecutable(identify(command, { signal }), selectedBytes)) throw changedExecutable();
      let spawned = false;
      let closeObserved = false;
      const invocation = { finished: false, closed: () => closeObserved || !spawned };
      invocations.add(invocation);
      try {
        const result = await spawn(command, [...prefix, ...args], {
          cwd: repoRoot, outputEncoding: 'utf8', maxOutputBytes: 16 * 1024 * 1024,
          rejectOnNonZeroExit: false, signal, ...options,
          onSpawn: () => { spawned = true; }
        });
        closeObserved = true;
        signal?.throwIfAborted();
        if (!sameExecutable(identify(command, { signal }), selectedBytes)) throw changedExecutable();
        if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) {
          throw Object.assign(new Error('Structural engine output exceeded its capture bound; partial results were rejected.'), { code: 'ERR_STRUCTURAL_OUTPUT_LIMIT' });
        }
        return { ...result, status: result.exitCode, error: null };
      } catch (error) {
        const termination = error.result?.termination;
        const observe = observePending(error);
        const confirmed = closeObserved || !spawned
          || (termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false);
        invocation.closed = () => confirmed || observe?.() === true;
        invocation.finished = true;
        if (!settled()) { pendingError = retainFailure(error); throw pendingError; }
        throw error;
      } finally {
        invocation.finished = true;
        if (invocation.closed()) invocations.delete(invocation);
      }
    };
    const version = await run([engine === 'comby' ? '-version' : '--version'], { timeoutMs: 5000, maxOutputBytes: 65536 });
    if (!verifyStructuralBinaryIdentity(engine, version)) throw Object.assign(new Error(`${engine} returned an unrecognized executable identity.`), { code: 'ERR_STRUCTURAL_IDENTITY' });
    return await execute({ command, run, installId: held?.receipt.installId || null });
  } catch (error) { observePending(error); primaryError = error; throw error; }
  finally {
    scopeClosed = true;
    if (!pendingError) {
      try { release(); }
      catch (error) { observePending(error); throw retainFailure(primaryError || error, primaryError ? error : null); }
    }
  }
};
