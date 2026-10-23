const unsafeCodes = new Set(['ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', 'ERR_WORKER_POOL_CLEANUP_TIMEOUT', 'BUILD_CLEANUP_TIMEOUT',
  'PISCINA_DESTROY_TIMEOUT', 'PISCINA_WORKER_TERMINATE_TIMEOUT', 'PISCINA_FORCE_TERMINATE_INCOMPLETE', 'ERR_PROCESS_TASK_BUDGET',
  'ERR_TOKENIZER_RESOURCE_PRESSURE', 'ERR_SCHEDULER_CPU_REACQUIRE', 'ERR_SCHEDULER_TASK_RETIRED',
  'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED', 'ERR_SCHEDULER_UNAWAITED_WAIT']);
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Recovery may replace only proven-settled ordinary work. Preserve each
 * original observer's receiver and inspect bounded cause/aggregate chains. */
export const isQueueRecoveryUnsafe = error => {
  const seen = new Set(), pending = [error];
  while (pending.length) {
    const current = pending.pop();
    if (!objectLike(current) || seen.has(current)) continue;
    if (seen.size >= 32) return true;
    seen.add(current);
    try {
      if (unsafeCodes.has(current.code) || current.workerOwnershipPending === true
        || current.schedulerCpuReacquisitionFailed === true) return true;
      const observer = current.cacheOwnershipReleased;
      if (typeof observer === 'function') { if (observer.call(current) !== true) return true; }
      else if (current.cacheOwnershipPending === true) return true;
      if (objectLike(current.cause)) pending.push(current.cause);
      if (objectLike(current.cpuReacquisitionError)) pending.push(current.cpuReacquisitionError);
      if (Array.isArray(current.errors)) {
        if (current.errors.length > 32) return true;
        pending.push(...current.errors);
      }
    } catch { return true; }
  }
  return false;
};
