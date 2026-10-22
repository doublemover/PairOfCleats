// Source UNVALIDATED. Async actual report/install probes retain exact managed
// physical bytes until shared child close or confirmed error reconciliation.
import { retainManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { resolveNoProvisionToolingEnvironment, isNonZeroToolingProbeSuccess } from '../../src/index/tooling/command-resolver.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';
import { applyToolLayoutValidation, locateToolExecutable, resolveDetectArgCandidates } from './utils.js';
import { resolveToolRoot } from '../shared/dict-utils.js';
import path from 'node:path';
import { isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';

const sameExecutable = (actual, expected) => actual.path === expected.path && actual.sha256 === expected.sha256
  && actual.size === expected.size;
const changedExecutable = phase => Object.assign(new Error(`Selected tool command bytes changed ${phase} probe.`), {
  code: 'ERR_TOOL_EXECUTABLE_CHANGED'
});

export const detectToolOwned = async (tool, { signal = null, env = process.env } = {}, dependencies = {}) => {
  signal?.throwIfAborted();
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) return located;
  signal?.throwIfAborted();
  let held = null, pending = null, primary = null;
  let released = false, closureConfirmed = () => true, firstFailure = null;
  let selectedInstallId = null, selectedRoot = null;
  let observerOverflow = false;
  const observers = [], observed = new WeakSet(), described = new WeakSet();
  const ownedMetadataFailures = new WeakSet();
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
  const settled = () => { try { return !observerOverflow && closureConfirmed() === true && observers.every(observe => observe()); } catch { return false; } };
  const release = () => {
    if (!settled()) throw Object.assign(new Error('Actual managed probe child/tree closure remains pending.'), { code: 'ERR_MANAGED_PROBE_PENDING' });
    if (released) return true;
    if (held) {
      let confirmed;
      try { confirmed = held.release(); }
      catch (error) {
        if (isStorageSessionReleaseFailure(error, held.storageSession)) ownedMetadataFailures.add(error);
        throw error;
      }
      if (confirmed !== true) throw Object.assign(new Error('Managed probe installation lease changed before release.'), { code: 'ERR_MANAGED_PROBE_RELEASE' });
    }
    held = null;
    released = true;
    return true;
  };
  const session = Object.freeze({ get installId() { return selectedInstallId; }, get root() { return selectedRoot; },
    releaseAfterClosure: () => {
      if (!settled()) throw retainFailure(Object.assign(new Error('Actual managed probe child/tree closure remains pending.',
        { cause: firstFailure }), { code: 'ERR_MANAGED_PROBE_PENDING' }));
      try { return release(); }
      catch (error) { observePending(error); throw retainFailure(firstFailure || error, error); }
    } });
  const retainFailure = (value, secondary = null) => {
    const error = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
    if (!firstFailure) firstFailure = error;
    const additional = secondary && secondary !== error ? secondary : null;
    const descriptors = {
      cacheOwnershipPending: { value: true, configurable: true, writable: true },
      cacheOwnershipReleased: { value: () => released && settled(), configurable: true, writable: true },
      managedProbeSession: { value: session, configurable: true },
      ...(additional ? { managedProbeReleaseError: { value: additional, configurable: true } } : {})
    };
    try {
      if (Object.hasOwn(error, 'managedProbeSession')) throw new Error('Existing probe owner must remain on its original failure.');
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
    if (tool.managedInstallation) held = await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: tool.toolingRoot,
      toolId: tool.id, descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId });
    selectedInstallId = held?.receipt.installId || null;
    selectedRoot = held?.root || null;
    if (held && held.receipt.installId !== tool.managedInstallation.installId) throw new Error('Managed physical tool selection changed before probe.');
    const candidate = held?.command || located.path;
    const prefix = held?.args || tool.managedInstallation?.args || [];
    const configured = tool.detect?.args || ['--version'];
    const configuredWithoutPrefix = prefix.every((value, index) => configured[index] === value) ? configured.slice(prefix.length) : configured;
    const candidates = resolveDetectArgCandidates({ ...tool, detect: { ...tool.detect, args: configuredWithoutPrefix } });
    const identify = dependencies.identify || identifyProvisioningExecutable;
    const identity = identify(candidate, { signal });
    const command = identity.path;
    if (typeof command !== 'string' || !path.isAbsolute(command) || !/^[a-f0-9]{64}$/.test(identity.sha256 || '')
      || !Number.isSafeInteger(identity.size) || identity.size < 0) {
      throw new Error('Selected tool executable identity is incomplete.');
    }
    const attempts = [];
    let selectedProbe = null;
    for (const args of candidates) {
      signal?.throwIfAborted();
      if (!sameExecutable(identify(command, { signal }), identity)) throw changedExecutable('before');
      const cwd = resolveToolRoot();
      let spawned = false;
      let closeObserved = false;
      closureConfirmed = () => closeObserved || !spawned;
      try {
        const result = await (dependencies.spawn || spawnResolvedSubprocess)(command, [...prefix, ...args], { cwd, signal,
          env: resolveNoProvisionToolingEnvironment(env, { command, providerId: tool.id, toolingRoot: tool.toolingRoot, cwd }),
          timeoutMs: 4000, outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false,
          onSpawn: () => { spawned = true; } });
        closeObserved = true;
        signal?.throwIfAborted();
        if (!sameExecutable(identify(command, { signal }), identity)) throw changedExecutable('during');
        const truncated = result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated;
        const recognized = !truncated && result.exitCode !== 0 && isNonZeroToolingProbeSuccess({ providerId: tool.id, command,
          stdout: result.stdout, stderr: result.stderr });
        const ok = !truncated && (result.exitCode === 0 || recognized);
        attempts.push({ args: [...prefix, ...args], outcome: truncated ? 'output-limit' : ok ? 'ok' : 'nonzero', status: result.exitCode,
          signal: result.signal || null, ...(ok ? {} : { stdoutExcerpt: redactDiagnosticText(result.stdout), stderrExcerpt: redactDiagnosticText(result.stderr) }) });
        if (ok) {
          selectedProbe = { ok: true, outcome: 'ok', attempts, verificationLevel: 'bounded-command-transport-and-layout',
            ...(recognized ? { acceptance: 'recognized-transport-usage' } : {}) };
          break;
        }
      } catch (error) {
        const termination = error.result?.termination;
        const observe = observePending(error);
        const confirmed = closeObserved || !spawned
          || (termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false);
        closureConfirmed = () => confirmed || observe?.() === true;
        if (!settled()) {
          pending = retainFailure(error);
          throw pending;
        }
        if (error.code === 'ERR_TOOL_EXECUTABLE_CHANGED') throw error;
        if (signal?.aborted) throw error;
        attempts.push({ args: [...prefix, ...args], outcome: error.name === 'SubprocessTimeoutError' ? 'timeout' : error.code === 'ENOENT' ? 'missing' : 'spawn-error',
          status: error.result?.exitCode ?? null, signal: error.result?.signal || null, errorCode: error.code || null,
          stderrExcerpt: redactDiagnosticText(error.message) });
      }
    }
    const probe = (dependencies.validate || applyToolLayoutValidation)(tool, command, selectedProbe || {
      ok: false, outcome: attempts.some(attempt => attempt.outcome === 'timeout') ? 'timeout' : attempts[0]?.outcome || 'inconclusive', attempts });
    return { found: probe.ok, path: probe.ok ? command : null, source: held ? 'managed' : located.source,
      probe, executableIdentity: identity, ...(held ? { installId: held.receipt.installId, descriptorId: held.receipt.descriptorId } : {}) };
  } catch (error) { observePending(error); primary = error; throw error; }
  finally {
    if (!pending) {
      try { release(); }
      catch (error) { observePending(error); throw retainFailure(primary || error, primary ? error : null); }
    }
  }
};
