import { prepareManagedChildStorage } from './child-environment.js';
import { runWithStorageSession } from './session.js';
import { isPathWithinRoot } from '../file-paths.js';
import { acquireStorageWriteReservation } from './admission.js';

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
    ...(admission?.writes || []).map(write => write.root)])];
  if (!roots.length) return { value: await execute({ env: plan.env, storage: { managed: true, externalOverridesOnly: true } }),
    resourceId: null, storage: { managed: true, externalOverridesOnly: true } };
  let started = false;
  let storage;
  const reservations = [];
  let result;
  try {
    result = await runWithStorageSession({ roots, coordinationRoot, authorizedRoots,
      scope: 'managed-child-storage', resourceId: `${plan.profileIdentity}:${plan.runId}` }, async session => {
      if (admission !== null) {
        for (const write of admission.writes) reservations.push(await acquireStorageWriteReservation({ ...write,
          resourceId: session.resourceId, coordinationRoot, authorizedRoots }));
      }
      storage = await prepareManagedChildStorage(plan, { authorizedRoots });
      started = true;
      return execute({ env: plan.env, storage, session });
    }, { settlement: async input => {
      // No child start proves only that execute did not begin. Admission may
      // already own a sealed reservation and an unreleased coordinator lock.
      const pendingAdmission = Boolean(input.error?.storageAdmissionSession) || input.error?.cacheOwnershipPending === true;
      const receipt = started ? await settlement(input) : { resourceId: input.resourceId,
        settled: !pendingAdmission, pending: pendingAdmission };
      if (receipt?.resourceId === input.resourceId && receipt.settled === true && receipt.pending === false) {
        for (const reservation of reservations) await reservation.releaseAfterSettlement(receipt);
      }
      return receipt;
    } });
  } catch (cause) {
    let error = cause && typeof cause === 'object' ? cause : new Error(String(cause), { cause });
    const outstanding = [...new Set([...reservations,
      ...(Array.isArray(error.storageWriteReservations) ? error.storageWriteReservations : [])])];
    const admissionSession = error.storageAdmissionSession;
    const storageSession = error.storageSession;
    const descriptors = { storageWriteReservations: { value: outstanding, configurable: true } };
    if (admissionSession && storageSession) {
      let released = false, reconciling = null;
      descriptors.managedChildAdmissionSession = { configurable: true, value: Object.freeze({ resourceId: storageSession.resourceId,
        releaseAfterSettlement: async receipt => {
          if (receipt?.resourceId !== storageSession.resourceId || receipt.settled !== true || receipt.pending !== false
            || admissionSession.resourceId !== storageSession.resourceId || typeof admissionSession.releaseAfterSettlement !== 'function') {
            throw new Error('Managed child admission requires its exact resource settlement owner and explicit pending:false.');
          }
          if (released) return true;
          if (!reconciling) reconciling = (async () => {
            await admissionSession.releaseAfterSettlement(receipt);
            for (const reservation of outstanding) await reservation.releaseAfterSettlement(receipt);
            const result = await storageSession.releaseAfterSettlement(receipt);
            released = true;
            return result;
          })().finally(() => { reconciling = null; });
          return reconciling;
        }
      }) };
    }
    try { Object.defineProperties(error, descriptors); }
    catch {
      const primary = error;
      error = new AggregateError([primary], primary.message || 'Managed child storage failed.', { cause: primary });
      for (const key of ['code', 'reason', 'cacheOwnershipPending', 'storageAdmissionSession', 'storageSession']) {
        if (primary[key] !== undefined) Object.defineProperty(error, key, { value: primary[key], configurable: true });
      }
      let observer;
      try { observer = primary.cacheOwnershipReleased; } catch { /* Unknown stays false. */ }
      if (primary.cacheOwnershipPending === true || typeof observer === 'function') error.cacheOwnershipReleased = () => {
        try { return typeof observer === 'function' && observer.call(primary) === true; } catch { return false; }
      };
      Object.defineProperties(error, descriptors);
    }
    throw error;
  }
  return { ...result, storage };
};
