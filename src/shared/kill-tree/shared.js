export const DEFAULT_GRACE_MS = 5000;
export const DEFAULT_SIGNAL = 'SIGTERM';

export const wait = (ms, { unrefTimer = true } = {}) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (unrefTimer && typeof timer.unref === 'function') {
    timer.unref();
  }
});

export const toGraceMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_GRACE_MS;
  return Math.floor(parsed);
};

export const scheduleUnrefTimer = (ms, fn) => {
  const timer = setTimeout(() => {
    try {
      fn();
    } catch {}
  }, ms);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
};
