import { createRepoCacheRetirementLedger, closeRepoCacheEntry } from '../../shared/repo-cache-retirement.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

/** One request retirement refers to the existing SQLite owners and ledger. It
 * neither adopts host caches nor grants native retry or early-close authority.
 */
export const createFederatedCacheRetirement = () => {
  const ledger = createRepoCacheRetirementLedger();
  let entry = null, completion = null, phase = 'waiting', failure = null, originalFailure = null, unknownResource = false;
  const isSettled = () => {
    if (phase !== 'finished' || unknownResource) return false;
    const receipt = ledger.getReceipt();
    return receipt.pendingOwners === 0 && !receipt.overflow && (!originalFailure || originalFailure.isSettled());
  };
  const receipt = () => {
    const resource = ledger.getReceipt();
    return Object.freeze({ ...resource, status: phase !== 'finished' ? 'draining' : failure ? 'failed' : resource.status,
      resourceStatus: resource.status, phase, failed: Boolean(failure), resourcesSettled: isSettled() });
  };
  const attach = (primary, original = observeStorageResource(primary, { phase: 'federation-failure' }), { ownedError = false } = {}) => (
    addStorageFailureContext(primary, { federationCacheRetirement: owner,
      cacheOwnershipPending: true, cacheOwnershipReleased: () => original.isSettled() && isSettled() },
    undefined, { nonEnumerable: ['federationCacheRetirement'], forceAggregate: !ownedError })
  );
  const start = (workers, disposeAdmission) => {
    if (completion) throw new Error('Federated cache retirement already started.');
    completion = Promise.allSettled(workers).then(() => {
      phase = 'retiring';
      let primary, failed = false;
      try { disposeAdmission(); } catch (error) { primary = error; failed = true; }
      if (entry) {
        // Capture the actual caches at their terminal boundary; native handles
        // and their original close methods already belong to the SQLite cache.
        try {
          ledger.register(entry);
          ledger.retire(entry, closeRepoCacheEntry, { terminal: true });
        } catch (error) {
          unknownResource = true;
          primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
          failed = true;
        }
      }
      try {
        const resource = ledger.report();
        if (resource.status !== 'settled') throw Object.assign(new Error('Federated caches retain active resources after worker settlement.'),
          { code: 'ERR_REPO_CACHE_RETIREMENT', repoCacheRetirement: resource });
      } catch (error) {
        primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
        failed = true;
      }
      phase = 'finished';
      if (failed) {
        originalFailure = observeStorageResource(primary, { phase: 'federation-cache-retirement' });
        failure = attach(primary, originalFailure);
        throw failure;
      }
      return receipt();
    });
    // Fail-fast callers receive the owner before siblings settle. Keep its
    // eventual rejection observable through drain(), not an unhandled rejection.
    completion.catch(() => {});
    return owner;
  };
  const owner = Object.freeze({
    register: caches => {
      if (entry || phase !== 'waiting') throw new Error('Federated request caches already registered or retiring.');
      entry = caches;
    }, start, attach, isSettled, getReceipt: receipt,
    get failure() { return failure; },
    drain: () => completion || Promise.reject(new Error('Federated cache retirement has not started.'))
  });
  return owner;
};
