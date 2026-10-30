import path from 'node:path';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { runWithStorageSession, isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { acquireStorageWriteReservation } from '../../src/shared/storage/admission.js';
import { bindDeclaredInstallAdmission, resolveDeclaredInstallAdmission } from './install-execution.js';
import { settleInstallDownload } from './install-shared.js';
import { getArchiveExtractionSession } from '../shared/archive-resource-owner.js';

const captureActionObservation = error => {
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

// The download producer retains its original error identity and records the
// actual teardown failure as a non-enumerable data property. At the outer
// install boundary, expose that secondary failure through standard error edges
// without replacing the response owner's exact primary error or capabilities.
const retainDownloadCleanupFailure = error => {
  try {
    const cleanup = Object.getOwnPropertyDescriptor(error, 'downloadCleanupError')?.value;
    return cleanup && cleanup !== error ? addStorageFailureContext(error, {}, cleanup) : error;
  } catch (inspectionError) {
    return addStorageFailureContext(error, {}, inspectionError);
  }
};

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
  let actionObservation = null;
  try {
    return await runWithStorageSession({ roots: [...new Set([toolingRoot, ...admission.writes.map(write => write.root)])],
      authorizedRoots, coordinationRoot, scope }, async session => {
      for (const write of admission.writes) reservations.push(await acquireStorageWriteReservation({ ...write,
        resourceId: session.resourceId, authorizedRoots, coordinationRoot }));
      try { return await execute(session); }
      catch (value) {
        const error = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
        actionObservation = captureActionObservation(error);
        // Preserve a verifier's own child-storage handles before the outer
        // publication session adds its separate lifetime handle to the error.
        const fields = {};
        if (error.storageSession) fields.installChildStorageSessions = [
          ...(Array.isArray(error.installChildStorageSessions) ? error.installChildStorageSessions : []), error.storageSession];
        if (Array.isArray(error.storageWriteReservations)) fields.installChildWriteReservations = [
          ...(Array.isArray(error.installChildWriteReservations) ? error.installChildWriteReservations : []), ...error.storageWriteReservations];
        throw Object.keys(fields).length ? addStorageFailureContext(error, fields, null, { nonEnumerable: Object.keys(fields) }) : error;
      }
    }, { settlement: async ({ resourceId, error }) => {
      let settled = actionObservation ? actionObservation() : error?.cacheOwnershipPending !== true;
      try {
        const observe = error?.cacheOwnershipReleased;
        if (typeof observe === 'function') settled = settled && observe.call(error) === true;
      } catch { settled = false; }
      const receipt = { resourceId, settled, pending: !settled };
      if (settled) for (const reservation of reservations) await reservation.releaseAfterSettlement(receipt);
      return receipt;
    } });
  } catch (error) {
    const outstanding = [...new Set([...reservations,
      ...(Array.isArray(error.storageWriteReservations) ? error.storageWriteReservations : [])])];
    const fields = { storageWriteReservations: outstanding };
    const storage = error.storageSession;
    let released = false, releasing = null;
    const retainOuterFailure = cause => {
      const childSessions = [...new Set([
        ...(Array.isArray(cause?.installChildStorageSessions) ? cause.installChildStorageSessions : []),
        ...(cause?.storageSession && cause.storageSession !== storage ? [cause.storageSession] : [])])];
      const retained = { ...fields, ...(storage ? { storageSession: storage } : {}),
        ...(childSessions.length ? { installChildStorageSessions: childSessions } : {}) };
      return addStorageFailureContext(retainDownloadCleanupFailure(cause), retained, error,
        { nonEnumerable: Object.keys(retained) });
    };
    const reconcile = async action => {
      try { return await action(); }
      catch (cause) { throw retainOuterFailure(cause); }
    };
    const settleOuter = async () => {
      if (actionObservation && !actionObservation()) throw new Error('Actual install action resource observer remains pending.');
      if (released) return true;
      if (!releasing) releasing = (async () => {
        const receipt = { resourceId: storage.resourceId, settled: true, pending: false };
        for (const reservation of reservations) {
          if (await reservation.releaseAfterSettlement(receipt) !== true) throw new Error('Install allocation owner did not confirm exact release.');
        }
        if (await storage.releaseAfterSettlement(receipt) !== true) throw new Error('Install storage owner did not confirm exact release.');
        released = true;
        return true;
      })().finally(() => { releasing = null; });
      return releasing;
    };
    const owned = error.managedInstallSession;
    if (owned && storage) {
      fields.managedInstallSession = { ...owned,
        releaseAfterSettlement: receipt => reconcile(async () => {
          if (await owned.releaseAfterSettlement(receipt) !== true) throw new Error('Managed install owner did not confirm exact release.');
          return settleOuter();
        }) };
    }
    const goOwned = error.goSdkInstallSession;
    if (goOwned && storage) {
      fields.goSdkInstallSession = { ...goOwned,
        releaseAfterClosure: () => reconcile(async () => {
          if (await goOwned.releaseAfterClosure() !== true) throw new Error('Go SDK owner did not confirm exact release.');
          return settleOuter();
        }) };
    }
    const archiveOwned = getArchiveExtractionSession(error);
    if (!owned && !goOwned && archiveOwned && storage) {
      fields.installArchiveSession = Object.freeze({ resourceId: storage.resourceId,
        releaseAfterClosure: () => reconcile(async () => {
          if (error.downloadSession) await settleInstallDownload(error);
          const receipt = await archiveOwned.releaseAfterClose();
          if (receipt?.resourceId !== archiveOwned.resourceId || receipt?.settled !== true || receipt?.pending !== false
            || !archiveOwned.isSettled()) throw new Error('Actual archive acquisition remains unsettled.');
          return settleOuter();
        }) });
    }
    // The Go release-index request can fail before an inner transaction exists.
    // Its outer storage reservations still belong to this actual response.
    if (!owned && !goOwned && error.downloadSession && storage) {
      fields.installDownloadSession = {
        resourceId: storage.resourceId, releaseAfterClosure: () => reconcile(async () => {
          await settleInstallDownload(error);
          return settleOuter();
        })
      };
    }
    if (!owned && !goOwned && error.storageAdmissionSession && storage) {
      const admission = error.storageAdmissionSession;
      fields.installAdmissionSession = {
        resourceId: storage.resourceId, releaseAfterClosure: () => reconcile(async () => {
          if (await admission.releaseAfterSettlement({ resourceId: admission.resourceId, settled: true, pending: false }) !== true) {
            throw new Error('Install admission owner did not confirm exact release.');
          }
          return settleOuter();
        })
      };
    }
    if (storage && (isStorageSessionReleaseFailure(error, storage)
      || isStorageSessionReleaseFailure(error.storageSettlementError, storage))) {
      const metadata = Object.freeze({ resourceId: storage.resourceId, releaseAfterSettlement: async receipt => {
        if (!receipt || Object.keys(receipt).sort().join(',') !== 'pending,resourceId,settled'
          || receipt.resourceId !== storage.resourceId || receipt.settled !== true || receipt.pending !== false) {
          throw new Error('Install storage metadata retry requires the exact resource receipt and explicit pending:false.');
        }
        return reconcile(settleOuter);
      } });
      fields.installStorageMetadataSession = metadata;
    }
    throw addStorageFailureContext(retainDownloadCleanupFailure(error), fields, null,
      { nonEnumerable: Object.keys(fields) });
  }
};
