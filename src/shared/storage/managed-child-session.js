import { prepareManagedChildStorage } from './child-environment.js';
import { runWithStorageSession, captureSettlementReceipt } from './session.js';
import { isPathWithinRoot } from '../file-paths.js';
import { acquireStorageWriteReservation, getStorageWriteAdmissionFailure } from './admission.js';
import { observeStorageResource } from './failure-observation.js';
import { addStorageFailureContext } from './operation-error.js';

/** Installer/runtime adoption owns preparation through actual child settlement.
 * Cache TTL/GC cannot infer that a timed-out child's writes have stopped.
 */
export const runManagedChildWithStorage = async ({ plan, authorizedRoots, coordinationRoot, admission = null }, execute, { settlement } = {}) => {
  if (typeof execute !== 'function' || typeof settlement !== 'function') throw new TypeError('Managed child execution needs its real execution and settlement owners.');
  if (!plan?.managed) return { value: await execute({ env: plan?.env, storage: { managed: false, external: true } }),
    resourceId: null, storage: { managed: false, external: true } };
  if (admission !== null && (!Array.isArray(admission.writes) || !admission.writes.length || admission.writes.length > 64)) {
    throw new TypeError('Managed write admission requires bounded explicit destination estimates.');
  }
  const roots = [...new Set([...plan.ownedRoots.filter(root => plan.locations.some(location => !location.external && isPathWithinRoot(location.path, root))),
    ...plan.locations.filter(location => !location.external && !location.file).map(location => location.path),
    ...(admission?.writes || []).map(write => write.root)])];
  if (!roots.length) return { value: await execute({ env: plan.env, storage: { managed: true, externalOverridesOnly: true } }),
    resourceId: null, storage: { managed: true, externalOverridesOnly: true } };
  let started = false;
  let storage;
  let storageSession = null, admissionFailure = null;
  const reservations = [];
  let result;
  try {
    result = await runWithStorageSession({ roots, coordinationRoot, authorizedRoots,
      scope: 'managed-child-storage', resourceId: `${plan.profileIdentity}:${plan.runId}` }, async session => {
      storageSession = session;
      if (admission !== null) {
        for (const write of admission.writes) {
          try { reservations.push(await acquireStorageWriteReservation({ ...write,
            resourceId: session.resourceId, coordinationRoot, authorizedRoots })); }
          catch (error) { admissionFailure = getStorageWriteAdmissionFailure(error); throw error; }
        }
      }
      storage = await prepareManagedChildStorage(plan, { authorizedRoots });
      started = true;
      return execute({ env: plan.env, storage, session });
    }, { settlement: async input => {
      // No child start proves only that execute did not begin. Admission may
      // already own a sealed reservation and an unreleased coordinator lock.
      const pendingAdmission = admissionFailure !== null;
      const receipt = started ? await settlement(input) : { resourceId: input.resourceId,
        settled: !pendingAdmission, pending: pendingAdmission };
      const captured = captureSettlementReceipt(receipt), declared = captured.receipt;
      if (declared.resourceId === input.resourceId && declared.settled === true && declared.pending === false) {
        // Use the session owner's first captured action observer, before a
        // settlement callback can replace its getter or claim premature close.
        input.resourceObservation.requireSettled(); captured.requireSettled();
        for (const reservation of reservations) {
          input.resourceObservation.requireSettled(); captured.requireSettled();
          await reservation.releaseAfterSettlement(declared);
        }
      }
      // Preserve the first receipt fields and its original independent resource
      // observation through the enclosing session's own acknowledgement check.
      return Object.freeze(Object.defineProperties({ ...declared }, {
        cacheOwnershipPending: { value: true },
        cacheOwnershipReleased: { value: () => { captured.requireSettled(); return true; } }
      }));
    } });
  } catch (cause) {
    const observation = observeStorageResource(cause, { phase: 'managed-child-original' });
    const error = observation.primary;
    const outstanding = Object.freeze([...new Set([...reservations, ...(admissionFailure?.reservations || [])])]);
    const admissionSession = admissionFailure?.owner;
    const descriptors = { storageWriteReservations: { value: outstanding, configurable: true },
      ...(storageSession ? { storageSession: { value: storageSession, configurable: true } } : {}) };
    if (admissionSession && storageSession) {
      const resourceId = storageSession.resourceId, releaseAdmission = admissionSession.releaseAfterSettlement;
      let released = false, reconciling = null;
      descriptors.managedChildAdmissionSession = { configurable: true, value: Object.freeze({ resourceId,
        releaseAfterSettlement: async receipt => {
          const captured = captureSettlementReceipt(receipt), declared = captured.receipt;
          if (declared.resourceId !== resourceId || declared.settled !== true || declared.pending !== false
            || admissionSession.resourceId !== resourceId || typeof releaseAdmission !== 'function') {
            throw new Error('Managed child admission requires its exact resource settlement owner and explicit pending:false.');
          }
          if (released) return true;
          if (!reconciling) reconciling = (async () => {
            captured.requireSettled();
            await releaseAdmission.call(admissionSession, declared);
            for (const reservation of outstanding) { captured.requireSettled(); await reservation.releaseAfterSettlement(declared); }
            captured.requireSettled();
            const result = await storageSession.releaseAfterSettlement(declared);
            released = true;
            return result;
          })().finally(() => { reconciling = null; });
          return reconciling;
        }
      }) };
    }
    try {
      // Ordinary mutable failures keep identity. Existing different capabilities
      // stay on the original cause rather than being silently overwritten.
      for (const [key, descriptor] of Object.entries(descriptors)) {
        const existing = Object.getOwnPropertyDescriptor(error, key);
        if (existing && (!Object.hasOwn(existing, 'value') || existing.value !== descriptor.value)) throw new Error('Original managed storage capability must be preserved.');
      }
      Object.defineProperties(error, descriptors);
    } catch (inspection) {
      const fields = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
      throw addStorageFailureContext(observation.retain(inspection, { inspectionPresent: true }), fields, null,
        { forceAggregate: true, nonEnumerable: Object.keys(fields) });
    }
    throw error;
  }
  return { ...result, storage };
};
