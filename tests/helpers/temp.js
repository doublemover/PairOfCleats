import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const makeTempDir = async (prefix = 'pairofcleats-') => {
  const base = path.join(os.tmpdir(), prefix);
  return fsPromises.mkdtemp(base);
};

export const rmDirRecursive = async (dirPath, { retries = 3, delayMs = 100 } = {}) => {
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
      return;
    } catch (error) {
      if (attempt >= resolvedRetries || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE'].includes(error?.code)) {
        throw error;
      }
      await wait(resolvedDelayMs * (attempt + 1));
    }
  }
};
