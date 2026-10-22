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
import { addStorageFailureContext, readStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const sameExecutable = (actual, expected) => actual.path === expected.path && actual.sha256 === expected.sha256
  && actual.size === expected.size;
const changedExecutable = phase => Object.assign(new Error(`Selected tool command bytes changed ${phase} probe.`), {
  code: 'ERR_TOOL_EXECUTABLE_CHANGED'
});
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });

export const detectToolOwned = async (tool, { signal = null, env = process.env } = {}, dependencies = {}) => {
  signal?.throwIfAborted();
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) return located;
  signal?.throwIfAborted();
  let held = null, pending = null, primary = null;
  let originalRelease = null, releaseCaptureError = null, heldStorageSession = null;
  let released = false, closureConfirmed = () => true, firstFailure = null;
  let selectedInstallId = null, selectedRoot = null;
  let observerOverflow = false;
  const observers = [], inspections = [], observed = new WeakSet(), described = new WeakSet();
  const contexts = new Set(), contextObservations = new WeakSet();
  const ownedMetadataFailures = new WeakSet();
  const rememberContext = error => {
    if (!readStorageFailureContext(error) || contexts.has(error)) return;
    if (contexts.size === 128) { observerOverflow = true; return; }
    contexts.add(error);
  };
  const retainInspection = value => {
    const error = asError(value);
    if (observed.has(error)) return;
    if (inspections.length === 64) { observerOverflow = true; return; }
    inspections.push(error); observePending(error);
  };
  const observePending = value => {
    const error = asError(value); rememberContext(error);
    if (observed.has(error) || described.has(error) || ownedMetadataFailures.has(error)) return null;
    observed.add(error);
    let original, marker, unreadable = false;
    try { original = error.cacheOwnershipReleased; }
    catch (inspection) { unreadable = true; retainInspection(inspection); }
    try { marker = error.cacheOwnershipPending; }
    catch (inspection) { unreadable = true; retainInspection(inspection); }
    let observer = null;
    if (unreadable || marker === true || typeof original === 'function') {
      observer = () => {
        if (unreadable) return false;
        try { return typeof original === 'function' && original.call(error) === true; }
        catch (inspection) { retainInspection(inspection); return false; }
      };
      if (observers.length < 128) observers.push(observer);
      else observerOverflow = true;
    }
    return observer;
  };
  const settled = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context.complete) observerOverflow = true;
      for (const inspection of context.inspectionErrors) {
        if (observed.has(inspection)) continue;
        observed.add(inspection);
        if (inspections.length < 64) inspections.push(inspection); else observerOverflow = true;
      }
      for (const observation of context.inspectionObservations) {
        if (described.has(observation.error) || ownedMetadataFailures.has(observation.error) || contextObservations.has(observation)) continue;
        contextObservations.add(observation);
        if (observers.length < 128) observers.push(observation.observe); else observerOverflow = true;
      }
    }
    try { return !observerOverflow && closureConfirmed() === true && observers.every(observe => observe()); }
    catch (inspection) { retainInspection(inspection); return false; }
  };
  const release = () => {
    if (!settled()) throw Object.assign(new Error('Actual managed probe child/tree closure remains pending.'), { code: 'ERR_MANAGED_PROBE_PENDING' });
    if (released) return true;
    if (held) {
      let confirmed;
      try {
        if (releaseCaptureError) throw releaseCaptureError;
        if (typeof originalRelease !== 'function') throw new Error('Original managed probe release owner is unavailable.');
        confirmed = originalRelease.call(held);
      }
      catch (error) {
        if (isStorageSessionReleaseFailure(error, heldStorageSession)) ownedMetadataFailures.add(error);
        throw error;
      }
      if (confirmed !== true) throw Object.assign(new Error('Managed probe installation lease changed before release.',
        { cause: confirmed }), { code: 'ERR_MANAGED_PROBE_RELEASE', ...(confirmed === false ? {} : { cacheOwnershipPending: true }) });
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
      catch (error) { observePending(error); throw retainFailure(firstFailure || error, error, { secondaryPresent: true }); }
    } });
  const retainFailure = (value, secondary = null, { secondaryPresent = secondary !== null && secondary !== undefined,
    secondaryField = 'managedProbeReleaseError' } = {}) => {
    const error = asError(value);
    if (!firstFailure) firstFailure = error;
    const additional = secondaryPresent && secondary !== error ? asError(secondary) : null;
    const diagnostic = Object.freeze(new AggregateError([...inspections], 'Managed probe installation remains retained.'));
    const fields = { cacheOwnershipPending: true, cacheOwnershipReleased: () => released && settled(), managedProbeSession: session,
      ...(additional ? { [secondaryField]: additional }
        : ownedMetadataFailures.has(error) ? { managedProbeReleaseError: error } : {}) };
    let retained = addStorageFailureContext(error, fields, additional || diagnostic,
      { nonEnumerable: ['managedProbeSession', 'managedProbeReleaseError', 'managedProbeInspectionError'] });
    const observe = Object.getOwnPropertyDescriptor(retained, 'cacheOwnershipReleased')?.value;
    Object.defineProperties(retained, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
      cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
    described.add(retained); rememberContext(retained); return retained;
  };
  try {
    if (tool.managedInstallation) held = await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: tool.toolingRoot,
      toolId: tool.id, descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId });
    if (held) {
      try {
        originalRelease = held.release;
        if (typeof originalRelease !== 'function') throw new TypeError('Managed probe retain handle has no original release owner.');
      } catch (value) { releaseCaptureError = asError(value); throw releaseCaptureError; }
      heldStorageSession = Object.getOwnPropertyDescriptor(held, 'storageSession')?.value || null;
    }
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
        observePending(result);
        if (!settled()) { pending = retainFailure(result); throw pending; }
        let truncated, recognized, ok, status, childSignal, stdout, stderr, excerpts;
        try {
          signal?.throwIfAborted();
          if (!sameExecutable(identify(command, { signal }), identity)) throw changedExecutable('during');
          const capture = result.outputCapture, stdoutCapture = capture?.stdout, stderrCapture = capture?.stderr;
          truncated = stdoutCapture?.truncated || stderrCapture?.truncated;
          status = result.exitCode; childSignal = result.signal; stdout = result.stdout; stderr = result.stderr;
          recognized = !truncated && status !== 0 && isNonZeroToolingProbeSuccess({ providerId: tool.id, command, stdout, stderr });
          ok = !truncated && (status === 0 || recognized);
          excerpts = ok ? {} : { stdoutExcerpt: redactDiagnosticText(stdout), stderrExcerpt: redactDiagnosticText(stderr) };
        } catch (value) { throw addStorageFailureContext(asError(value), {}, result, { secondaryPresent: true }); }
        if (!settled()) { pending = retainFailure(result); throw pending; }
        attempts.push({ args: [...prefix, ...args], outcome: truncated ? 'output-limit' : ok ? 'ok' : 'nonzero', status,
          signal: childSignal || null, ...excerpts });
        if (ok) {
          selectedProbe = { ok: true, outcome: 'ok', attempts, verificationLevel: 'bounded-command-transport-and-layout',
            ...(recognized ? { acceptance: 'recognized-transport-usage' } : {}) };
          break;
        }
      } catch (value) {
        const error = asError(value);
        if (described.has(error)) { pending = error; throw error; }
        const observe = observePending(error);
        let confirmed = closeObserved || !spawned;
        if (!confirmed) {
          try {
            const result = error.result, termination = result?.termination;
            confirmed = termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false;
          } catch (inspection) {
            retainInspection(inspection);
            closureConfirmed = () => confirmed || observe?.() === true;
            pending = retainFailure(error, inspection, { secondaryPresent: true, secondaryField: 'managedProbeInspectionError' });
            throw pending;
          }
        }
        closureConfirmed = () => confirmed || observe?.() === true;
        if (!settled()) {
          pending = retainFailure(error);
          throw pending;
        }
        let code, name, status, childSignal, excerpt;
        try {
          code = error.code; name = error.name;
          const result = error.result;
          status = result?.exitCode ?? null; childSignal = result?.signal || null;
          excerpt = redactDiagnosticText(error.message);
        } catch (inspection) {
          retainInspection(inspection);
          const retained = retainFailure(error, inspection, { secondaryPresent: true, secondaryField: 'managedProbeInspectionError' });
          if (!settled()) pending = retained;
          throw retained;
        }
        if (code === 'ERR_TOOL_EXECUTABLE_CHANGED') throw error;
        if (signal?.aborted) throw error;
        if (!settled()) { pending = retainFailure(error); throw pending; }
        attempts.push({ args: [...prefix, ...args], outcome: name === 'SubprocessTimeoutError' ? 'timeout' : code === 'ENOENT' ? 'missing' : 'spawn-error',
          status, signal: childSignal, errorCode: typeof code === 'string' ? code : null, stderrExcerpt: excerpt });
      }
    }
    const probe = (dependencies.validate || applyToolLayoutValidation)(tool, command, selectedProbe || {
      ok: false, outcome: attempts.some(attempt => attempt.outcome === 'timeout') ? 'timeout' : attempts[0]?.outcome || 'inconclusive', attempts });
    return { found: probe.ok, path: probe.ok ? command : null, source: held ? 'managed' : located.source,
      probe, executableIdentity: identity, ...(held ? { installId: held.receipt.installId, descriptorId: held.receipt.descriptorId } : {}) };
  } catch (value) { const error = asError(value); observePending(error); primary = error; throw error; }
  finally {
    if (!pending) {
      try { release(); }
      catch (value) {
        const error = asError(value); observePending(error);
        throw retainFailure(primary || error, error, { secondaryPresent: primary !== null });
      }
    }
  }
};
