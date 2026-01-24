import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const makeTempDir = async (prefix = 'pairofcleats-') => {
  const base = path.join(os.tmpdir(), prefix);
  return fsPromises.mkdtemp(base);
};

export const rmDirRecursive = async (dirPath, { retries = 3, delayMs = 100 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= retries || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) {
        throw error;
      }
      await wait(delayMs * (attempt + 1));
    }
  }
};
