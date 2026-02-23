import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

export const RETRYABLE_REMOVE_ERROR_CODES = new Set([
  'EPERM',
  'EACCES',
  'EBUSY',
  'ENOTEMPTY',
  'EMFILE',
  'ENFILE',
  'EAGAIN'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pathExists = (targetPath, existsSync = fs.existsSync) => {
  try {
    return Boolean(existsSync(targetPath));
  } catch {
    return false;
  }
};

/**
 * Best-effort remove with retry/backoff for transient filesystem contention.
 *
 * @param {string} targetPath
 * @param {{
 *   recursive?:boolean,
 *   force?:boolean,
 *   attempts?:number,
 *   baseDelayMs?:number,
 *   maxDelayMs?:number,
 *   rm?:(path:string, options:{recursive:boolean,force:boolean}) => Promise<void>,
 *   exists?:(path:string) => boolean
 * }} [options]
 * @returns {Promise<{ok:boolean,attempts:number,error:Error|null}>}
 */
export const removePathWithRetry = async (targetPath, options = {}) => {
  const {
    recursive = true,
    force = true,
    attempts = 12,
    baseDelayMs = 25,
    maxDelayMs = 1000,
    rm = fsPromises.rm,
    exists = fs.existsSync
  } = options;

  const maxAttempts = Number.isFinite(Number(attempts))
    ? Math.max(1, Math.floor(Number(attempts)))
    : 12;
  const delayFloor = Number.isFinite(Number(baseDelayMs))
    ? Math.max(1, Math.floor(Number(baseDelayMs)))
    : 25;
  const delayCap = Number.isFinite(Number(maxDelayMs))
    ? Math.max(delayFloor, Math.floor(Number(maxDelayMs)))
    : 1000;

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive, force });
      if (!pathExists(targetPath, exists)) {
        return { ok: true, attempts: attempt + 1, error: null };
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { ok: true, attempts: attempt + 1, error: null };
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!RETRYABLE_REMOVE_ERROR_CODES.has(error?.code) || attempt >= maxAttempts - 1) {
        break;
      }
    }
    if (attempt < maxAttempts - 1) {
      await sleep(Math.min(delayCap, delayFloor * (attempt + 1)));
    }
  }

  if (!pathExists(targetPath, exists)) {
    return { ok: true, attempts: maxAttempts, error: null };
  }
  return {
    ok: false,
    attempts: maxAttempts,
    error: lastError || new Error(`Failed to remove path: ${targetPath}`)
  };
};
