import { observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';

const MAX_FAILURES = 128;

export const closeRepoCacheEntry = entry => {
  let failed = false, primary;
  for (const close of [() => entry?.indexCache?.clear?.(), () => entry?.sqliteCache?.closeAll?.()]) {
    try { close(); }
    catch (error) { primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; failed = true; }
  }
  if (failed) throw primary;
};

/** Service-scoped retirement receipts refer to existing cache/close owners;
 * they neither own another native handle registry nor retry a native close.
 */
export const createRepoCacheRetirementLedger = () => {
  const entries = new WeakMap(), retiring = new Set();
  let pruneCursor = retiring.values();
  const retain = (record, error) => {
    if (record.failures.has(error)) return;
    if (record.failures.size === MAX_FAILURES) { record.overflow = true; return; }
    record.failures.set(error, { observation: observeStorageResource(error, { phase: 'repo-cache-retirement' }), reported: false });
  };
  const register = entry => {
    const cache = entry.sqliteCache;
    const record = { key: entry.repoRoot, failures: new Map(), owners: new Map(), overflow: false,
      readOwners: cache ? cache.pendingOwners.bind(cache) : () => [],
      dispose: cache ? cache.dispose.bind(cache) : () => {} };
    entries.set(entry, record);
    pruneSettled();
  };
  const observeOwners = record => {
    try {
      for (const owner of record.readOwners()) {
        if (!record.owners.has(owner)) record.owners.set(owner, { isSettled: owner.isSettled.bind(owner) });
      }
    } catch (error) { retain(record, error); }
    for (const [owner, captured] of record.owners) {
      try {
        if (captured.isSettled()) { record.owners.delete(owner); continue; }
        if (owner.lastError !== null) retain(record, owner.lastError);
      } catch (error) { retain(record, error); }
    }
  };
  const reconcile = record => {
    observeOwners(record);
    for (const [error, state] of record.failures) {
      if (!state.reported) continue;
      try { if (state.observation.isSettled()) record.failures.delete(error); }
      catch (inspection) { retain(record, inspection); }
    }
    if (!record.owners.size && !record.failures.size && !record.overflow) retiring.delete(record);
  };
  const pruneSettled = () => {
    // Cache misses amortize small retirement reconciliation; ordinary cache hits
    // never scan historical owners and no timer/native retry is introduced.
    for (let index = 0; index < 4; index++) {
      const next = pruneCursor.next();
      if (next.done) { pruneCursor = retiring.values(); break; }
      reconcile(next.value);
    }
  };
  const retire = (entry, shutdown, { terminal = false } = {}) => {
    const record = entries.get(entry);
    if (!record) throw new Error('Repository cache retirement requires its registered owner.');
    retiring.add(record);
    try { shutdown(entry); } catch (error) { retain(record, error); }
    // An evicted entry can still be leased. Dispose retires discoverability;
    // only the existing lease/close owner decides when native close can run.
    if (terminal) {
      try { record.dispose(); } catch (error) { retain(record, error); }
    }
    observeOwners(record);
    if (!record.owners.size && !record.failures.size && !record.overflow) retiring.delete(record);
  };
  const inspect = key => {
    const selected = [], errors = [], observations = [], ownerObservers = [];
    let pendingOwners = 0, activeLeaseOwners = 0, failedCloseOwners = 0, overflow = false, failureCount = 0;
    for (const record of retiring) {
      if (key !== undefined && record.key !== key) continue;
      reconcile(record); selected.push(record); overflow ||= record.overflow;
      for (const [owner, captured] of record.owners) {
        ownerObservers.push(captured.isSettled); pendingOwners++;
        // These are actual frozen SQLite close owners, not projected errors.
        if (owner.lastError === null) activeLeaseOwners++; else failedCloseOwners++;
      }
      for (const [error, state] of record.failures) {
        let settled = false;
        try { settled = state.observation.isSettled(); }
        catch (inspection) { retain(record, inspection); }
        if (settled && state.reported) { record.failures.delete(error); continue; }
        observations.push(state.observation.isSettled);
        failureCount++;
        if (errors.length < MAX_FAILURES) errors.push(error);
      }
      overflow ||= record.overflow;
      if (!record.owners.size && !record.failures.size && !record.overflow) retiring.delete(record);
    }
    const receipt = Object.freeze({ status: failureCount || failedCloseOwners || overflow ? 'failed'
      : pendingOwners ? 'retiring' : 'settled', retiringEntries: selected.filter(record => retiring.has(record)).length,
    pendingOwners, activeLeaseOwners, failedCloseOwners, failureCount, omittedFailures: Math.max(0, failureCount - errors.length), overflow });
    return { receipt, selected, errors, observations, ownerObservers };
  };
  const report = key => {
    const { receipt, selected, errors, observations, ownerObservers } = inspect(key);
    if (!errors.length && !receipt.overflow) return receipt;
    for (const record of selected) for (const state of record.failures.values()) state.reported = true;
    const released = () => !receipt.overflow && [...ownerObservers, ...observations].every(observe => {
      try { return observe() === true; } catch { return false; }
    });
    let failure = addStorageFailureContext(errors.length ? errors[0] : new Error('Repository cache retirement diagnostics exceeded their bound.'),
      { code: 'ERR_REPO_CACHE_RETIREMENT', repoCacheRetirement: receipt,
        cacheOwnershipPending: true, cacheOwnershipReleased: released }, undefined, { forceAggregate: true });
    for (let index = 1; index < errors.length; index++) {
      failure = addStorageFailureContext(failure, {}, errors[index], { secondaryPresent: true });
    }
    throw failure;
  };
  return Object.freeze({ register, retire, report, getReceipt: () => inspect().receipt });
};
