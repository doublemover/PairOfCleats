import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

export const watchObservationFailure = error => {
  const observation = observeStorageResource(error, { phase: 'watch-source-observation' });
  observation.requireSettled();
  let rawCode, name;
  try { rawCode = error?.code; name = error?.name; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  if (rawCode === 'ABORT_ERR' || name === 'AbortError') throw error;
  const code = typeof rawCode === 'string' && rawCode.length <= 128 ? rawCode : 'ERR_WATCH_PATH_OBSERVATION';
  return { state: ['ENOENT', 'ENOTDIR'].includes(code) ? 'absent' : 'unknown', code, error };
};

/** Retry unknown classification through the existing update queue. Timers own
 * no index work, and the parent queue retains active observations at shutdown. */
export const createWatchSourceObservations = ({ onRetry, onFailure = () => {}, onChange = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) => {
  const epochs = new Map(), failures = new Map();
  let closed = false, unstableCount = 0;
  const cancelTimer = entry => {
    if (entry?.timer != null) clearTimer(entry.timer);
    if (entry) { entry.timer = null; entry.retryAt = null; }
  };
  const invalidate = file => {
    if (closed) return;
    epochs.set(file, Symbol());
    const failure = failures.get(file);
    cancelTimer(failure);
    if (failure) failure.missingCount = 0;
  };
  const forget = file => {
    const previous = failures.get(file);
    if (previous?.code === 'ERR_WATCH_SOURCE_UNSTABLE') unstableCount--;
    cancelTimer(previous); failures.delete(file); epochs.delete(file);
  };
  const observe = async (file, classify) => {
    if (closed) return null;
    if (!epochs.has(file)) epochs.set(file, Symbol());
    const epoch = epochs.get(file);
    let result;
    try { result = await classify(); }
    catch (error) { result = watchObservationFailure(error); }
    if (closed || epochs.get(file) !== epoch) return null;
    if (result.state !== 'unknown' && result.state !== 'absent') {
      forget(file); onChange(); return result;
    }
    const previous = failures.get(file);
    const missingCount = result.state === 'absent' ? (previous?.missingCount || 0) + 1 : 0;
    if (missingCount >= 2) {
      forget(file); onChange(); return { skip: true, state: 'absent', reason: 'missing', code: result.code };
    }
    const attempt = Math.min(Number.MAX_SAFE_INTEGER, (previous?.attempt || 0) + 1);
    const delay = Math.min(5000, 50 * (2 ** Math.min(attempt - 1, 10)));
    cancelTimer(previous);
    if (previous?.code === 'ERR_WATCH_SOURCE_UNSTABLE') unstableCount--;
    if (result.code === 'ERR_WATCH_SOURCE_UNSTABLE') unstableCount++;
    const entry = { code: result.code, attempt, missingCount, retryAt: now() + delay, timer: null };
    failures.set(file, entry);
    entry.timer = setTimer(() => {
      entry.timer = null; entry.retryAt = null;
      if (closed || epochs.get(file) !== epoch || failures.get(file) !== entry) return;
      onRetry(file); onChange();
    }, delay);
    entry.timer?.unref?.();
    onChange(); onFailure(result.error, file, { code: entry.code, attempt, retryAt: entry.retryAt });
    return null;
  };
  return { observe, invalidate,
    remove(file) { forget(file); onChange(); },
    pendingCount: () => failures.size,
    stabilityRetryCount: () => unstableCount,
    snapshot: () => {
      const rows = [];
      for (const [file, entry] of failures) {
        rows.push({ file, code: entry.code, attempt: entry.attempt, retryAt: entry.retryAt });
        if (rows.length === 16) break;
      }
      return { pending: failures.size, failures: rows };
    },
    close() { closed = true; for (const entry of failures.values()) cancelTimer(entry); }
  };
};
