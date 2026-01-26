import { retryWithBackoff } from '../../../shared/retry.js';
import { acquireIndexLock } from '../lock.js';

const LOCK_BACKOFF_BASE_MS = 50;
const LOCK_BACKOFF_MAX_MS = 2000;
const LOCK_BACKOFF_LOG_INTERVAL_MS = 5000;
const LOCK_BACKOFF_MAX_WAIT_MS = 15000;

export const acquireIndexLockWithBackoff = async ({
  repoCacheRoot,
  shouldExit,
  log: logFn,
  backoff = null
}) => {
  const baseMs = Number.isFinite(backoff?.baseMs) ? backoff.baseMs : LOCK_BACKOFF_BASE_MS;
  const maxMs = Number.isFinite(backoff?.maxMs) ? backoff.maxMs : LOCK_BACKOFF_MAX_MS;
  const logIntervalMs = Number.isFinite(backoff?.logIntervalMs)
    ? backoff.logIntervalMs
    : LOCK_BACKOFF_LOG_INTERVAL_MS;
  const maxWaitMs = Number.isFinite(backoff?.maxWaitMs)
    ? backoff.maxWaitMs
    : LOCK_BACKOFF_MAX_WAIT_MS;
  return await retryWithBackoff({
    task: async () => acquireIndexLock({ repoCacheRoot, log: logFn }),
    shouldStop: shouldExit,
    baseMs,
    maxMs,
    maxWaitMs,
    logIntervalMs,
    onLog: ({ initial }) => {
      if (initial) {
        logFn?.('[watch] Index lock held; backing off before retry.');
      } else {
        logFn?.('[watch] Still waiting for index lock...');
      }
    }
  });
};
