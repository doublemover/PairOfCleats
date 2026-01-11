import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export const createTempPath = (filePath) => {
  const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tempPath = `${filePath}${suffix}`;
  if (process.platform !== 'win32' || tempPath.length <= 240) {
    return tempPath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath) || '.bin';
  const shortName = `.tmp-${Math.random().toString(16).slice(2, 10)}${ext}`;
  return path.join(dir, shortName);
};

export const replaceFile = async (tempPath, finalPath) => {
  const bakPath = `${finalPath}.bak`;
  const finalExists = fsSync.existsSync(finalPath);
  let backupAvailable = fsSync.existsSync(bakPath);
  if (finalExists && !backupAvailable) {
    try {
      await fs.rename(finalPath, bakPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fsSync.existsSync(bakPath);
      }
    }
  }
  try {
    await fs.rename(tempPath, finalPath);
  } catch (err) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM' && err?.code !== 'ENOTEMPTY') {
      throw err;
    }
    if (!backupAvailable) {
      throw err;
    }
    try {
      await fs.rm(finalPath, { force: true });
    } catch {}
    await fs.rename(tempPath, finalPath);
  }
};
