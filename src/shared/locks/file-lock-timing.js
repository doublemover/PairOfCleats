import { createAbortError } from '../abort.js';
import {
  DEFAULT_FILE_LOCK_STALE_MS,
  INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT,
  INVALID_LOCK_RECLAIM_GRACE_MS_MAX
} from './file-lock-constants.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sleepWithAbort = (ms, signal = null) => {
  if (!signal || typeof signal.aborted !== 'boolean') return sleep(ms);
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timerId);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

export const toNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveInvalidLockReclaimGraceMs = ({
  staleMs,
  pollMs,
  overrideMs = null
} = {}) => {
  const override = Number(overrideMs);
  if (Number.isFinite(override) && override >= 0) {
    return Math.min(INVALID_LOCK_RECLAIM_GRACE_MS_MAX, Math.floor(override));
  }
  const staleWindow = Number(staleMs);
  const pollWindow = Number(pollMs);
  const staleBound = Number.isFinite(staleWindow) && staleWindow > 0
    ? Math.floor(Math.max(INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT, staleWindow * 0.1))
    : INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT;
  const pollBound = Number.isFinite(pollWindow) && pollWindow > 0
    ? Math.floor(Math.max(INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT, pollWindow * 8))
    : INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT;
  return Math.min(INVALID_LOCK_RECLAIM_GRACE_MS_MAX, Math.max(staleBound, pollBound));
};

export const resolvePositiveStaleMs = (staleMs) => (
  toPositiveNumber(staleMs, DEFAULT_FILE_LOCK_STALE_MS)
);
