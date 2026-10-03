const lockRuntimeMetrics = {
  hookFailures: 0,
  parentMissingRetries: 0,
  staleRemoveOwnerFailedForceSucceeded: 0
};

export const safeInvokeHook = (hook, payload, { code = 'LOCK_HOOK_ERROR' } = {}) => {
  if (typeof hook !== 'function') return;
  try {
    hook(payload);
  } catch (err) {
    lockRuntimeMetrics.hookFailures += 1;
    const message = err?.message || String(err || 'unknown lock hook failure');
    try {
      process.emitWarning(`[file-lock] hook failed: ${message}`, { code });
    } catch {}
  }
};

export const getFileLockRuntimeMetrics = () => ({
  hookFailures: Number(lockRuntimeMetrics.hookFailures) || 0,
  parentMissingRetries: Number(lockRuntimeMetrics.parentMissingRetries) || 0,
  staleRemoveOwnerFailedForceSucceeded: Number(lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded) || 0
});

export const resetFileLockRuntimeMetricsForTests = () => {
  lockRuntimeMetrics.hookFailures = 0;
  lockRuntimeMetrics.parentMissingRetries = 0;
  lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded = 0;
};

export const incrementParentMissingRetriesMetric = () => {
  lockRuntimeMetrics.parentMissingRetries += 1;
};

export const incrementStaleRemoveOwnerFailedForceSucceededMetric = () => {
  lockRuntimeMetrics.staleRemoveOwnerFailedForceSucceeded += 1;
};
