import { describeStorageFailure, observeStorageResource } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import { runBuildCleanupWithTimeout, isOwnedBuildCleanupTimeout } from '../../cleanup-timeout.js';

/** The telemetry owner retains original persistence failures privately. Safe
 * diagnostics cannot grant settlement or replace a throwing observation. */
export const createCrashPersistence = ({ log = null } = {}) => {
  const failures = [], sinks = new Map(), resources = [], warnings = [], diagnostics = new Set();
  let serial = Promise.resolve(), pending = 0, omittedWarnings = 0;
  const attempt = async (sink, targetPath, persist, { warn = true } = {}) => {
    try {
      await persist();
      sinks.set(sink, { sink, path: targetPath, ok: true });
    } catch (error) {
      let retained = error, diagnostic;
      try {
        diagnostic = describeStorageFailure(error, { phase: 'crash-evidence-' + sink,
          defaultCode: 'ERR_CRASH_FORENSICS_PERSIST', defaultMessage: 'Crash evidence persistence failed.' });
      } catch (inspection) {
        retained = inspection;
        diagnostic = { code: 'ERR_CRASH_FORENSICS_UNQUALIFIED',
          message: 'Crash evidence failure is retained; resource settlement or diagnostic inspection is unqualified.' };
      }
      resources.push({ error: retained, observation: observeStorageResource(retained, { phase: 'crash-evidence-' + sink }) });
      const failure = { sink, path: targetPath, ok: false, code: diagnostic.code.slice(0, 128),
        message: diagnostic.message.slice(0, 2048), timestamp: new Date().toISOString() };
      failures.push(failure); sinks.set(sink, failure);
      if (warn && typeof log === 'function') {
        if (warnings.length < 64) warnings.push(`[tree-sitter:schedule] crash evidence ${sink} persistence failed: ${failure.message}`);
        else omittedWarnings++;
      }
    }
  };
  const scheduleWarnings = () => {
    // Original evidence sinks run first. A broken/hung warning callback cannot
    // suppress local, durable or external persistence; it remains owned work.
    const captured = warnings.splice(0);
    if (captured.length) startDiagnostic(async () => {
      for (const message of captured) await attempt('warning', null, () => log(message), { warn: false });
    });
  };
  const startDiagnostic = worker => {
    const operation = Promise.resolve().then(worker)
      .catch(error => attempt('presentation', null, () => Promise.reject(error))).then(scheduleWarnings);
    diagnostics.add(operation);
    operation.then(() => diagnostics.delete(operation), () => diagnostics.delete(operation));
    return operation;
  };
  const isSettled = () => {
    let settled = pending === 0 && diagnostics.size === 0;
    for (const resource of resources) {
      try { if (resource.observation.isSettled() !== true) settled = false; }
      catch (inspection) {
        resource.error = resource.observation.retain(inspection, { inspectionPresent: true });
        resource.observation = observeStorageResource(resource.error, { phase: 'crash-evidence-settlement-inspection' });
        settled = false;
      }
    }
    return settled;
  };
  const snapshot = () => {
    const settled = isSettled();
    return { ok: failures.length === 0 && settled, pending: !settled, pendingOperations: pending + diagnostics.size,
      failures: failures.map(row => ({ ...row })), sinks: [...sinks.values()].map(row => ({ ...row })), omittedWarnings };
  };
  return Object.freeze({ attempt, isSettled, snapshot, present: startDiagnostic,
    enqueue(worker) {
      pending++;
      serial = serial.then(worker).catch(error => attempt('serialization', null, () => Promise.reject(error)))
        .then(scheduleWarnings).finally(() => { pending--; });
      // The owner joins this exact chain later; callers do not need a detached
      // rejection handler and a failure never erases later queued work.
      serial.catch(() => {});
      return serial;
    },
    async wait() {
      let observed;
      do {
        observed = serial; await observed;
        await Promise.all([...diagnostics]);
      } while (observed !== serial || diagnostics.size > 0);
      if (!isSettled()) {
        const blockers = [];
        for (const resource of resources) {
          try { resource.observation.requireSettled(); }
          catch (error) { blockers.push(error); }
        }
        let error = addStorageFailureContext(blockers.shift() || new Error('Crash evidence work remains unsettled.'),
          { crashPersistence: snapshot() }, null, { forceAggregate: true });
        for (const blocker of blockers) error = addStorageFailureContext(error, {}, blocker, { secondaryPresent: true });
        throw error;
      }
      return snapshot();
    }
  });
};

/** Only this exact deadline owner may attach the original sink's settlement
 * observation. A caller-supplied error code never grants that authority. */
export const waitForSchedulerCrashPersistence = async (tracker, { mode, timeoutMs } = {}) => {
  const deadlineOwner = {};
  try {
    await runBuildCleanupWithTimeout({ label: `tree-sitter-scheduler.${mode}.crash-persistence`,
      cleanup: () => tracker.waitForPersistence(), deadlineOwner, swallowTimeout: false, timeoutMs });
  } catch (error) {
    if (isOwnedBuildCleanupTimeout(error, deadlineOwner)) {
      Object.defineProperty(error, 'cacheOwnershipReleased', { value: tracker.isPersistenceSettled });
    }
    throw error;
  }
};
