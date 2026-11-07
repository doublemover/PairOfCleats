import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

/** Observation only. Exact receipt fields never override earlier original
 * result, receipt or inspection prerequisites, and convey no release authority. */
export const createManagedVerificationObservation = () => {
  const ownFailures = new WeakSet();
  const ledger = createStorageObservationLedger({ isOwnFailure: error => ownFailures.has(error) });
  const inputs = [], inputSet = new WeakSet();
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
  const remember = value => {
    ledger.remember(value);
    if (value !== null && ['object', 'function'].includes(typeof value) && !ownFailures.has(value) && !inputSet.has(value)) {
      inputSet.add(value); if (inputs.length < 128) inputs.push(value); else ledger.markIncomplete();
    }
    return value;
  };
  const inspect = (value, action) => {
    remember(value);
    try { return action(); }
    catch (error) {
      remember(error);
      // Genuine producer/getter failures keep their original throw contract.
      // Our own pending guard also needs the value whose inspection it refused.
      if (!ownFailures.has(error)) throw error;
      const failure = addStorageFailureContext(error, {}, value, { secondaryPresent: true, forceAggregate: true,
        ownerMessage: 'Original managed field or receipt inspection failed.' });
      // This exact aggregate belongs to this ledger; its self-observation is
      // not an additional prerequisite. Independent inspections still are.
      ownFailures.add(failure); ledger.remember(failure); throw failure;
    }
  };
  const read = (value, field) => inspect(value, () => {
    check();
    let result;
    try { result = value?.[field]; }
    catch (error) { remember(error); throw error; }
    if (result !== null && ['object', 'function'].includes(typeof result)) remember(result);
    check(); return result;
  });
  const exactReceipt = (receipt, resourceId) => inspect(receipt, () => {
    check();
    let shape;
    try { shape = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled'; }
    catch (error) { remember(error); throw error; }
    check();
    if (!shape) return false;
    const captured = { resourceId: read(receipt, 'resourceId'), settled: read(receipt, 'settled'), pending: read(receipt, 'pending') };
    check(); return captured.resourceId === resourceId && captured.settled === true && captured.pending === false;
  });
  const settlement = (value, resourceId) => exactReceipt(read(value, 'settlement'), resourceId);
  const witness = () => inputs.length === 1 ? inputs[0] : Object.freeze({ errors: Object.freeze([...inputs]) });
  const project = value => inspect(value, () => {
    check(); const keys = Object.keys(value); check(); const result = {};
    if (keys.length > 256) { ledger.markIncomplete(); check(); }
    for (const key of keys) {
      if (key === 'cacheOwnershipPending' || key === 'cacheOwnershipReleased') continue;
      Object.defineProperty(result, key, { value: read(value, key), enumerable: true, writable: true, configurable: true });
    }
    check(); return result;
  });
  const finish = report => {
    check();
    Object.defineProperties(report, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: ledger.isSettled },
      ...(inputs.length ? { cause: { value: witness() } } : {}) });
    ownFailures.add(report); return report;
  };
  const failure = (error, fields = {}) => {
    remember(error);
    const retained = addStorageFailureContext(error, { ...fields, cacheOwnershipPending: true, cacheOwnershipReleased: ledger.isSettled },
      witness(), { secondaryPresent: inputs.length > 0, forceAggregate: inputs.some(value => value !== error),
        ownerMessage: ledger.isSettled() ? null : 'Managed verification failed; original observations remain pending.' });
    ownFailures.add(retained); ledger.remember(retained); return retained;
  };
  return Object.freeze({ remember, check, read, settlement, exactReceipt, isSettled: ledger.isSettled,
    project, finish, failure,
    originalObservation: ledger.originalObservation,
    rememberComposition(value) { ownFailures.add(value); ledger.remember(value); return value; },
    hasObservedResources() { const snapshot = ledger.snapshot(); return snapshot.observerCount > 0 || snapshot.contextCount > 0 || !snapshot.complete; } });
};
