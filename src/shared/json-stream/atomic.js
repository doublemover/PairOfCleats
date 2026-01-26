import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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

const getBakPath = (filePath) => `${filePath}.bak`;

export const replaceFile = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const bakPath = getBakPath(finalPath);
  const finalExists = fs.existsSync(finalPath);
  let backupAvailable = fs.existsSync(bakPath);
  const copyFallback = async () => {
    try {
      await fsPromises.copyFile(tempPath, finalPath);
      await fsPromises.rm(tempPath, { force: true });
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await fsPromises.rename(finalPath, bakPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fs.existsSync(bakPath);
      }
    }
  }
  try {
    await fsPromises.rename(tempPath, finalPath);
    if (!keepBackup && backupAvailable) {
      try { await fsPromises.rm(bakPath, { force: true }); } catch {}
    }
  } catch (err) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV'].includes(err?.code)) {
      throw err;
    }
    if (!backupAvailable) {
      if (await copyFallback()) return;
      throw err;
    }
    try {
      await fsPromises.rm(finalPath, { force: true });
    } catch {}
    try {
      await fsPromises.rename(tempPath, finalPath);
      if (!keepBackup && backupAvailable) {
        try { await fsPromises.rm(bakPath, { force: true }); } catch {}
      }
    } catch (renameErr) {
      if (await copyFallback()) return;
      throw renameErr;
    }
  }
};
