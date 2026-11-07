import { observeStorageResource } from './failure-observation.js';

/** Cooperative admission across one storage workflow's phases. This stops new
 * work; descriptors, directory iterators and metadata exclusions already owned
 * must still finish through their original cleanup owners. Never classify the
 * stop by a copied code/message: callers retain this exact invocation object. */
export const createStorageInspectionAdmission = (maxDurationMs, signal = null) => {
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new TypeError('Storage inspection requires a positive bounded duration.');
  const started = Date.now(), stop = new Error('Storage inspection admission stopped.'); let reason = null;
  return { stop,
    get reason() { return reason; },
    isStop(error) {
      if (error !== stop) return false;
      // An original cleanup owner may attach its retained resource observation
      // to the same primary stop error. Identity alone cannot erase that owner.
      observeStorageResource(error, { phase: 'storage-inspection-stop' }).requireSettled();
      return true;
    },
    check() {
      if (signal?.aborted) reason = 'cancelled';
      else if (Date.now() - started >= maxDurationMs) reason ||= 'time-budget';
      if (reason) throw stop;
    },
    stopFor(value) { reason = value; throw stop; }
  };
};

