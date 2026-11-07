import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';

/** Observation only. Exact receipt fields never override earlier original
 * result, receipt or inspection prerequisites, and convey no release authority. */
export const createManagedVerificationObservation = () => {
  const ownFailures = new WeakSet();
  const ledger = createStorageObservationLedger({ isOwnFailure: error => ownFailures.has(error) });
  const check = () => {
    try { ledger.requireSettled(); }
    catch (error) {
      ownFailures.add(error);
      const inspections = ledger.snapshot().inspectionErrors;
      if (!inspections.length) throw error;
      const failure = Object.assign(new AggregateError([error, ...inspections], 'Original managed verification observations remain pending.', { cause: error }), {
        cacheOwnershipPending: true, cacheOwnershipReleased: ledger.isSettled
      });
      ownFailures.add(failure); throw failure;
    }
  };
  const remember = value => { ledger.remember(value); return value; };
  const read = (value, field) => {
    remember(value); check();
    let result;
    try { result = value?.[field]; }
    catch (error) { remember(error); throw error; }
    check(); return result;
  };
  const settlement = (value, resourceId) => {
    const receipt = read(value, 'settlement'); remember(receipt); check();
    const shape = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled';
    check();
    if (!shape) return false;
    const captured = { resourceId: read(receipt, 'resourceId'), settled: read(receipt, 'settled'), pending: read(receipt, 'pending') };
    check(); return captured.resourceId === resourceId && captured.settled === true && captured.pending === false;
  };
  return Object.freeze({ remember, check, read, settlement, isSettled: ledger.isSettled,
    hasObservedResources() { const snapshot = ledger.snapshot(); return snapshot.observerCount > 0 || snapshot.contextCount > 0 || !snapshot.complete; } });
};
