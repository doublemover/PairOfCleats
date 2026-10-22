import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import {
  REPLACE_TEMP_WAIT_ATTEMPTS,
  REPLACE_TEMP_WAIT_BASE_DELAY_MS,
  areComparablePathsEqual,
  copyFileWithDurability,
  copyFileWithDurabilitySync,
  createSiblingBackupPath,
  maybeReportExdevFallback,
  renameWithRetry,
  renameWithRetrySync,
  waitForPath
} from './persistence-helpers.js';

const createTempMissingError = (tempPath) => Object.assign(
  new Error(`Temp file missing before replace: ${tempPath}`), { code: 'ERR_TEMP_MISSING' }
);

const readFinalStat = (finalPath) => {
  try {
    const stat = fsSync.lstatSync(finalPath, { bigint: true });
    if (stat.isDirectory()) {
      throw Object.assign(new Error(`Final path is a directory; file replace requires a file target: ${finalPath}`),
        { code: 'EISDIR' });
    }
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const samePathAlreadyCommitted = (tempPath, finalPath) => {
  if (!areComparablePathsEqual(tempPath, finalPath)) return false;
  if (fsSync.existsSync(finalPath)) return true;
  throw createTempMissingError(tempPath);
};

const concurrentCommitSucceeded = (tempPath, finalPath, sourceStat) => {
  if (fsSync.existsSync(tempPath)) return false;
  const stat = readFinalStat(finalPath);
  return !!stat && !!sourceStat && sourceStat.ino > 0n && stat.ino === sourceStat.ino && stat.dev === sourceStat.dev
    && stat.size === sourceStat.size && stat.mtimeNs === sourceStat.mtimeNs;
};

/**
 * Publish with one overwrite rename. A retained backup is copied while the
 * authoritative target stays visible. EXDEV stages a durable copy beside the
 * target before the same atomic commit; other rename failures leave it intact.
 */
export const replaceFile = async (tempPath, finalPath, options = {}) => {
  if (samePathAlreadyCommitted(tempPath, finalPath)) return;
  const initialStat = readFinalStat(finalPath);
  if (!(await waitForPath(tempPath, {
    attempts: REPLACE_TEMP_WAIT_ATTEMPTS, baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS, signal: options.signal
  }))) {
    throw createTempMissingError(tempPath);
  }
  const sourceStat = fsSync.lstatSync(tempPath, { bigint: true });
  let backupPath = null, stagedPath = null, committed = false;
  try {
    if (initialStat && options.keepBackup === true) {
      backupPath = createSiblingBackupPath(finalPath);
      await copyFileWithDurability(finalPath, backupPath);
    }
    try {
      await renameWithRetry(tempPath, finalPath, { signal: options.signal });
    } catch (error) {
      if (error.code === 'ENOENT' && concurrentCommitSucceeded(tempPath, finalPath, sourceStat)) {
        committed = true;
        return;
      }
      if (error.code !== 'EXDEV') throw error;
      stagedPath = `${createSiblingBackupPath(finalPath)}.tmp`;
      await copyFileWithDurability(tempPath, stagedPath);
      await renameWithRetry(stagedPath, finalPath, { signal: options.signal });
      committed = true;
      await fs.rm(tempPath, { force: true });
      maybeReportExdevFallback(options, error.code);
    }
    committed = true;
  } finally {
    if (stagedPath) await fs.rm(stagedPath, { force: true }).catch(() => {});
    if (backupPath && !committed) await fs.rm(backupPath, { force: true }).catch(() => {});
  }
};

export const replaceFileSync = (tempPath, finalPath, options = {}) => {
  if (samePathAlreadyCommitted(tempPath, finalPath)) return;
  const initialStat = readFinalStat(finalPath);
  if (!fsSync.existsSync(tempPath)) {
    throw createTempMissingError(tempPath);
  }
  const sourceStat = fsSync.lstatSync(tempPath, { bigint: true });
  let backupPath = null, stagedPath = null, committed = false;
  try {
    if (initialStat && options.keepBackup === true) {
      backupPath = createSiblingBackupPath(finalPath);
      copyFileWithDurabilitySync(finalPath, backupPath);
    }
    try {
      renameWithRetrySync(tempPath, finalPath);
    } catch (error) {
      if (error.code === 'ENOENT' && concurrentCommitSucceeded(tempPath, finalPath, sourceStat)) {
        committed = true;
        return;
      }
      if (error.code !== 'EXDEV') throw error;
      stagedPath = `${createSiblingBackupPath(finalPath)}.tmp`;
      copyFileWithDurabilitySync(tempPath, stagedPath);
      renameWithRetrySync(stagedPath, finalPath);
      committed = true;
      fsSync.rmSync(tempPath, { force: true });
      maybeReportExdevFallback(options, error.code);
    }
    committed = true;
  } finally {
    if (stagedPath) { try { fsSync.rmSync(stagedPath, { force: true }); } catch {} }
    if (backupPath && !committed) { try { fsSync.rmSync(backupPath, { force: true }); } catch {} }
  }
};
