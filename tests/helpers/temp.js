import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const RETRYABLE_RM_CODES = new Set([
  'EPERM',
  'EACCES',
  'EBUSY',
  'ENOTEMPTY',
  'EMFILE',
  'ENFILE',
  'ENOENT'
]);

export const makeTempDir = async (prefix = 'pairofcleats-') => {
  const base = path.join(os.tmpdir(), prefix);
  return fsPromises.mkdtemp(base);
};

export const rmDirRecursive = async (
  dirPath,
  { retries = 3, delayMs = 100, ignoreRetryableFailure = false } = {}
) => {
  const resolvedRetries = Math.max(0, Math.floor(Number(retries) || 0));
  const resolvedDelayMs = Math.max(1, Math.floor(Number(delayMs) || 1));
  for (let attempt = 0; attempt <= resolvedRetries; attempt += 1) {
    try {
      await fsPromises.rm(dirPath, {
        recursive: true,
        force: true,
        maxRetries: resolvedRetries,
        retryDelay: resolvedDelayMs
      });
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return true;
      }
      const retryable = RETRYABLE_RM_CODES.has(error?.code);
      if (attempt >= resolvedRetries || !retryable) {
        if (attempt >= resolvedRetries && retryable) {
          const tombstone = `${dirPath}.pending-delete-${Date.now()}-${process.pid}`;
          try {
            await fsPromises.rename(dirPath, tombstone);
            for (let cleanupAttempt = 0; cleanupAttempt <= resolvedRetries; cleanupAttempt += 1) {
              try {
                await fsPromises.rm(tombstone, { recursive: true, force: true });
                return true;
              } catch (cleanupError) {
                const cleanupRetryable = RETRYABLE_RM_CODES.has(cleanupError?.code);
                if (cleanupAttempt >= resolvedRetries || !cleanupRetryable) break;
                await wait(resolvedDelayMs * (cleanupAttempt + 1));
              }
            }
          } catch {}
        }
        if (retryable && ignoreRetryableFailure) return false;
        throw error;
      }
      await wait(resolvedDelayMs * (attempt + 1));
    }
  }
  return false;
};
