import path from 'node:path';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { runWithStorageSession } from '../../src/shared/storage/session.js';
import { acquireStorageWriteReservation } from '../../src/shared/storage/admission.js';
import { bindDeclaredInstallAdmission, resolveDeclaredInstallAdmission } from './install-execution.js';

/** Actual archive/SDK writer boundary. Canonical recipes provide inclusive
 * estimates for each actual destination; unknown capacity never triggers GC.
 */
export const runInstallWithStorageAdmission = async ({ toolingRoot, storageEstimate, scope = 'managed-tool-publication' }, execute) => {
  const declared = resolveDeclaredInstallAdmission({ storageEstimate });
  const admission = bindDeclaredInstallAdmission(declared, { artifactRoot: toolingRoot, storagePlan: { locations: [], scratch: null } });
  if (!admission) throw Object.assign(new Error('Managed archive/SDK writes deferred: complete destination allocation estimates are unavailable.'),
    { code: 'ERR_INSTALL_STORAGE_ESTIMATE_REQUIRED' });
  const layout = resolveStorageLayout({ overrides: { tooling: toolingRoot } });
  const coordinationRoot = path.join(layout.descriptors.state.path, 'storage-access');
  const authorizedRoots = Object.values(layout.descriptors).map(descriptor => descriptor.path);
  const reservations = [];
  try {
    return await runWithStorageSession({ roots: [...new Set([toolingRoot, ...admission.writes.map(write => write.root)])],
      authorizedRoots, coordinationRoot, scope }, async session => {
      for (const write of admission.writes) reservations.push(await acquireStorageWriteReservation({ ...write,
        resourceId: session.resourceId, authorizedRoots, coordinationRoot }));
      try { return await execute(session); }
      catch (error) {
        // Preserve a verifier's own child-storage handles before the outer
        // publication session adds its separate lifetime handle to the error.
        if (error.storageSession) error.installChildStorageSessions = [...(error.installChildStorageSessions || []), error.storageSession];
        if (error.storageWriteReservations) error.installChildWriteReservations = [...(error.installChildWriteReservations || []), ...error.storageWriteReservations];
        throw error;
      }
    }, { settlement: async ({ resourceId, error }) => {
      const settled = error?.cacheOwnershipPending !== true;
      const receipt = { resourceId, settled, pending: !settled };
      if (settled) for (const reservation of reservations) await reservation.releaseAfterSettlement(receipt);
      return receipt;
    } });
  } catch (error) {
    Object.defineProperty(error, 'storageWriteReservations', { value: reservations, configurable: true });
    const owned = error.managedInstallSession;
    if (owned && error.storageSession) {
      const storage = error.storageSession;
      Object.defineProperty(error, 'managedInstallSession', { configurable: true, value: { ...owned,
        releaseAfterSettlement: async receipt => {
          await owned.releaseAfterSettlement(receipt);
          const storageReceipt = { resourceId: storage.resourceId, settled: true, pending: false };
          for (const reservation of reservations) await reservation.releaseAfterSettlement(storageReceipt);
          return storage.releaseAfterSettlement(storageReceipt);
        } } });
    }
    const goOwned = error.goSdkInstallSession;
    if (goOwned && error.storageSession) {
      const storage = error.storageSession;
      Object.defineProperty(error, 'goSdkInstallSession', { configurable: true, value: { ...goOwned,
        releaseAfterClosure: async () => {
          await goOwned.releaseAfterClosure();
          const receipt = { resourceId: storage.resourceId, settled: true, pending: false };
          for (const reservation of reservations) await reservation.releaseAfterSettlement(receipt);
          return storage.releaseAfterSettlement(receipt);
        } } });
    }
    throw error;
  }
};
