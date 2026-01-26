export function createDebouncedScheduler({ debounceMs, onRun, onSchedule, onCancel, onFire, onError }) {
  let timer = null;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
      if (onCancel) onCancel();
    }
    timer = setTimeout(() => {
      timer = null;
      if (onFire) onFire();
      void Promise.resolve()
        .then(() => onRun())
        .catch((err) => {
          if (onError) onError(err);
        });
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
