import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

let tempPathCounter = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createTempToken = () => {
  tempPathCounter = (tempPathCounter + 1) >>> 0;
  const counter = tempPathCounter.toString(16).padStart(8, '0');
  const hr = process.hrtime.bigint().toString(16);
  const random = crypto.randomBytes(6).toString('hex');
  return `${process.pid}-${hr}-${counter}-${random}`;
};

const waitForPath = async (targetPath, { attempts = 3, baseDelayMs = 10 } = {}) => {
  const resolvedAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 3;
  const resolvedBaseDelay = Number.isFinite(baseDelayMs) ? Math.max(1, Math.floor(baseDelayMs)) : 10;
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    if (fs.existsSync(targetPath)) return true;
    if (attempt < resolvedAttempts - 1) {
      await sleep(resolvedBaseDelay * (attempt + 1));
    }
  }
  return false;
};

const safeStat = async (targetPath) => {
  try {
    return await fsPromises.stat(targetPath);
  } catch {
    return null;
  }
};

export const createTempPath = (filePath) => {
  const token = createTempToken();
  const suffix = `.tmp-${token}`;
  const tempPath = `${filePath}${suffix}`;
  if (process.platform !== 'win32' || tempPath.length <= 232) {
    return tempPath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const compactToken = crypto
    .createHash('sha1')
    .update(filePath)
    .update(':')
    .update(token)
    .digest('hex');

  const buildCompactPath = (maxLen) => {
    const budget = maxLen - dir.length - 1 - ext.length;
    // Keep at least "t-" + 4 chars so compact fallbacks stay unique.
    if (budget < 6) return null;
    const tokenBudget = Math.max(4, budget - 2);
    const name = `t-${compactToken.slice(0, tokenBudget)}`;
    return path.join(dir, `${name}${ext}`);
  };

  const buildCompactPathNoExt = (maxLen) => {
    const budget = maxLen - dir.length - 1;
    if (budget < 4) return null;
    const tokenBudget = Math.max(2, budget - 2);
    return path.join(dir, `t-${compactToken.slice(0, tokenBudget)}`);
  };

  return (
    buildCompactPath(232)
    || buildCompactPath(240)
    || buildCompactPathNoExt(232)
    || buildCompactPathNoExt(240)
    || tempPath
  );
};

const getBakPath = (filePath) => `${filePath}.bak`;

export const replaceFile = async (tempPath, finalPath, options = {}) => {
  const startedAt = Date.now();
  const keepBackup = options.keepBackup === true;
  const bakPath = getBakPath(finalPath);
  const finalExists = fs.existsSync(finalPath);
  let backupAvailable = fs.existsSync(bakPath);
  const restoreBackup = async () => {
    if (!backupAvailable) return false;
    if (fs.existsSync(finalPath) || !fs.existsSync(bakPath)) return false;
    try {
      await fsPromises.rename(bakPath, finalPath);
      backupAvailable = false;
      return true;
    } catch {
      return false;
    }
  };
  if (!(await waitForPath(tempPath, { attempts: 6, baseDelayMs: 10 }))) {
    if (fs.existsSync(finalPath)) {
      if (!keepBackup && backupAvailable) {
        try { await fsPromises.rm(bakPath, { force: true }); } catch {}
      }
      return;
    }
    const finalStat = await safeStat(finalPath);
    if (finalStat && finalStat.mtimeMs >= startedAt - 2000) {
      return;
    }
    if (await restoreBackup()) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
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
    if (err?.code === 'ENOENT') {
      if (await waitForPath(tempPath, { attempts: 4, baseDelayMs: 10 })) {
        try {
          await fsPromises.rename(tempPath, finalPath);
        } catch (retryErr) {
          await restoreBackup();
          throw retryErr;
        }
        if (!keepBackup && backupAvailable) {
          try { await fsPromises.rm(bakPath, { force: true }); } catch {}
        }
        return;
      }
      if (fs.existsSync(finalPath)) {
        if (!keepBackup && backupAvailable) {
          try { await fsPromises.rm(bakPath, { force: true }); } catch {}
        }
        return;
      }
      const finalStat = await safeStat(finalPath);
      if (finalStat && finalStat.mtimeMs >= startedAt - 2000) {
        if (!keepBackup && backupAvailable) {
          try { await fsPromises.rm(bakPath, { force: true }); } catch {}
        }
        return;
      }
      if (await restoreBackup()) return;
      const missingErr = new Error(`Temp file missing before replace: ${tempPath}`);
      missingErr.code = 'ERR_TEMP_MISSING';
      throw missingErr;
    }
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV'].includes(err?.code)) {
      await restoreBackup();
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
      await restoreBackup();
      throw renameErr;
    }
  }
};

export const replaceDir = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const bakPath = `${finalPath}.bak`;
  const finalExists = fs.existsSync(finalPath);
  if (!fs.existsSync(tempPath)) {
    const err = new Error(`Temp dir missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  let backupAvailable = fs.existsSync(bakPath);
  const restoreBackup = async () => {
    if (!backupAvailable) return;
    try {
      if (fs.existsSync(finalPath)) {
        await fsPromises.rm(finalPath, { recursive: true, force: true });
      }
    } catch {}
    try {
      await fsPromises.rename(bakPath, finalPath);
    } catch {}
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
      try { await fsPromises.rm(bakPath, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV'].includes(err?.code)) {
      await restoreBackup();
      throw err;
    }
    try {
      if (fs.existsSync(finalPath)) {
        await fsPromises.rm(finalPath, { recursive: true, force: true });
      }
      await fsPromises.rename(tempPath, finalPath);
      if (!keepBackup && backupAvailable) {
        try { await fsPromises.rm(bakPath, { recursive: true, force: true }); } catch {}
      }
    } catch (renameErr) {
      await restoreBackup();
      throw renameErr;
    }
  }
};
