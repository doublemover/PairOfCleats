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
      const receipt = started ? await settlement(input) : { resourceId: input.resourceId, settled: true, pending: false };
      if (receipt?.resourceId === input.resourceId && receipt.settled === true && receipt.pending === false) {
        for (const reservation of reservations) await reservation.releaseAfterSettlement(receipt);
      }
      return receipt;
    } });
  } catch (error) {
    Object.defineProperty(error, 'storageWriteReservations', { value: reservations, configurable: true });
    throw error;
  }
  return { ...result, storage };
};
