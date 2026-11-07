export function createDebouncedScheduler({ debounceMs, maxWaitMs = null, onRun, onSchedule, onCancel, onFire, onError }) {
  let timer = null;
  let firstScheduledAt = null;
  const reportError = (error) => {
    try {
      const result = onError?.(error);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };
  const schedule = () => {
    firstScheduledAt ??= performance.now();
    if (timer) {
      clearTimeout(timer);
      if (onCancel) onCancel();
    }
    timer = setTimeout(() => {
      timer = null;
      firstScheduledAt = null;
      try {
        const result = onFire?.();
        if (result && typeof result.catch === 'function') result.catch(reportError);
      } catch (error) {
        reportError(error);
      }
      void Promise.resolve()
        .then(() => onRun())
        .catch(reportError);
    }, Number.isFinite(maxWaitMs) && maxWaitMs >= 0
      ? Math.min(debounceMs, Math.max(0, maxWaitMs - (performance.now() - firstScheduledAt)))
      : debounceMs);
    if (onSchedule) onSchedule();
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    firstScheduledAt = null;
    if (onCancel) onCancel();
  };
  return { schedule, cancel };
}
