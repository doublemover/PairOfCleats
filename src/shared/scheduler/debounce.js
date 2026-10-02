export function createDebouncedScheduler({ debounceMs, onRun, onSchedule, onCancel, onFire, onError }) {
  let timer = null;
  const reportError = (error) => {
    try {
      const result = onError?.(error);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
      if (onCancel) onCancel();
    }
    timer = setTimeout(() => {
      timer = null;
      try {
        const result = onFire?.();
        if (result && typeof result.catch === 'function') result.catch(reportError);
      } catch (error) {
        reportError(error);
      }
      void Promise.resolve()
        .then(() => onRun())
        .catch(reportError);
    }, debounceMs);
    if (onSchedule) onSchedule();
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    if (onCancel) onCancel();
  };
  return { schedule, cancel };
}
