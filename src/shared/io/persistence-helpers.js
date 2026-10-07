import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const WINDOWS_PATH_BUDGET = 240;
export const MIN_COMPACT_TOKEN_CHARS = 12;
export const REPLACE_TEMP_WAIT_ATTEMPTS = 20;
export const REPLACE_TEMP_WAIT_BASE_DELAY_MS = 25;
export const REPLACE_FILE_RENAME_RETRY_ATTEMPTS = 10;
export const REPLACE_FILE_RENAME_BASE_DELAY_MS = 20;
export const REPLACE_DIR_RENAME_ATTEMPTS = 10;
export const REPLACE_DIR_RENAME_BASE_DELAY_MS = 20;
export const REPLACE_COMMITTED_FINAL_GRACE_MS = 5_000;
export const LONG_PATH_PREFIX = '\\\\?\\';
export const RETRYABLE_FILE_RENAME_CODES = new Set([
  'EEXIST',
  'EPERM',
  'ENOTEMPTY',
  'EACCES',
  'EXDEV',
  'EBUSY'
]);
export const RETRYABLE_DIR_RENAME_CODES = new Set([
  'EEXIST',
  'EPERM',
  'ENOTEMPTY',
  'EACCES',
  'EXDEV',
  'EBUSY'
]);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripLongPathPrefix = (value) => (
  typeof value === 'string' && value.startsWith(LONG_PATH_PREFIX)
    ? value.slice(LONG_PATH_PREFIX.length)
    : value
);

const toComparablePath = (value) => path.resolve(stripLongPathPrefix(value));

export const areComparablePathsEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  try {
    return toComparablePath(left) === toComparablePath(right);
  } catch {
    return false;
  }
};

export const waitForPath = async (targetPath, { attempts = 3, baseDelayMs = 10 } = {}) => {
  const resolvedAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 3;
  const resolvedBaseDelay = Number.isFinite(baseDelayMs) ? Math.max(1, Math.floor(baseDelayMs)) : 10;
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    if (fsSync.existsSync(targetPath)) return true;
    if (attempt < resolvedAttempts - 1) {
      await sleep(resolvedBaseDelay * (attempt + 1));
    }
  }
  return false;
};

export const hasRecentlyCommittedFinalPath = (
  targetPath,
  graceMs = REPLACE_COMMITTED_FINAL_GRACE_MS
) => {
  try {
    const stat = fsSync.statSync(targetPath);
    const cutoff = Date.now() - Math.max(0, Number(graceMs) || 0);
    return Number.isFinite(stat.mtimeMs) && stat.mtimeMs >= cutoff;
  } catch {
    return false;
  }
};

export const syncParentDirectory = async (targetPath) => {
  let handle = null;
  try {
    handle = await fs.open(path.dirname(targetPath), 'r');
    await handle.sync();
  } catch (err) {
    const code = String(err?.code || '').toUpperCase();
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM') {
      throw err;
    }
  } finally {
    try {
      await handle?.close();
    } catch {}
  }
};

export const syncParentDirectorySync = (targetPath) => {
  let fd = null;
  try {
    fd = fsSync.openSync(path.dirname(targetPath), 'r');
    fsSync.fsyncSync(fd);
  } catch (err) {
    const code = String(err?.code || '').toUpperCase();
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM') {
      throw err;
    }
  } finally {
    if (typeof fd === 'number') {
      try {
        fsSync.closeSync(fd);
      } catch {}
    }
  }
};

export const copyFileWithDurability = async (sourcePath, targetPath) => {
  await fs.copyFile(sourcePath, targetPath);
  let targetHandle = null;
  try {
    targetHandle = await fs.open(targetPath, 'r+');
    await targetHandle.sync();
  } finally {
    try {
      await targetHandle?.close();
    } catch {}
  }
  await syncParentDirectory(targetPath);
};

export const copyFileWithDurabilitySync = (sourcePath, targetPath) => {
  fsSync.copyFileSync(sourcePath, targetPath);
  let fd = null;
  try {
    fd = fsSync.openSync(targetPath, 'r+');
    fsSync.fsyncSync(fd);
  } finally {
    if (typeof fd === 'number') {
      try {
        fsSync.closeSync(fd);
      } catch {}
    }
  }
  syncParentDirectorySync(targetPath);
};

export const createSiblingBackupPath = (targetPath) => {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const entropy = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return path.join(dir, `.${base}.bak-${entropy}`);
};

export const cleanupBackupIfNeeded = async ({ keepBackup, backupAvailable, bakPath }) => {
  if (keepBackup || !backupAvailable) return;
  try {
    await fs.rm(bakPath, { force: true });
  } catch {}
};

export const cleanupBackupIfNeededSync = ({ keepBackup, backupAvailable, bakPath }) => {
  if (keepBackup || !backupAvailable) return;
  try {
    fsSync.rmSync(bakPath, { force: true });
  } catch {}
};

export const renameWithRetry = async (
  fromPath,
  toPath,
  {
    attempts = REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
    baseDelayMs = REPLACE_FILE_RENAME_BASE_DELAY_MS,
    retryableCodes = RETRYABLE_FILE_RENAME_CODES
  } = {}
) => {
  const resolvedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  const resolvedBaseDelay = Math.max(1, Math.floor(Number(baseDelayMs) || 1));
  let lastError = null;
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    try {
      await fs.rename(fromPath, toPath);
      return;
    } catch (err) {
      lastError = err;
      if (!retryableCodes.has(err?.code) || attempt >= resolvedAttempts - 1) {
        throw err;
      }
      await sleep(resolvedBaseDelay * (attempt + 1));
    }
  }
  throw lastError;
};

export const renameWithRetrySync = (
  fromPath,
  toPath,
  {
    attempts = REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
    retryableCodes = RETRYABLE_FILE_RENAME_CODES
  } = {}
) => {
  const resolvedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastError = null;
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    try {
      fsSync.renameSync(fromPath, toPath);
      return;
    } catch (err) {
      lastError = err;
      if (!retryableCodes.has(err?.code) || attempt >= resolvedAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastError;
};

export const maybeReportExdevFallback = (options = {}, reasonCode = null) => {
  if (reasonCode !== 'EXDEV') return;
  if (typeof options.onExdevFallback === 'function') {
    try {
      options.onExdevFallback();
    } catch {}
  }
};
