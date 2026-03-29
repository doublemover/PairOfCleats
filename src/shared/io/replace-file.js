import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import {
  REPLACE_COMMITTED_FINAL_GRACE_MS,
  REPLACE_FILE_RENAME_BASE_DELAY_MS,
  REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
  REPLACE_TEMP_WAIT_ATTEMPTS,
  REPLACE_TEMP_WAIT_BASE_DELAY_MS,
  RETRYABLE_FILE_RENAME_CODES,
  areComparablePathsEqual,
  cleanupBackupIfNeeded,
  cleanupBackupIfNeededSync,
  copyFileWithDurability,
  copyFileWithDurabilitySync,
  createSiblingBackupPath,
  hasRecentlyCommittedFinalPath,
  maybeReportExdevFallback,
  renameWithRetry,
  renameWithRetrySync,
  waitForPath
} from './persistence-helpers.js';

const resolveCommittedFinalGraceWithTempWaitMs = () => (
  REPLACE_COMMITTED_FINAL_GRACE_MS
  + (REPLACE_TEMP_WAIT_BASE_DELAY_MS * ((REPLACE_TEMP_WAIT_ATTEMPTS - 1) * REPLACE_TEMP_WAIT_ATTEMPTS) / 2)
);

const renameWithBackupSwap = async (tempPath, targetPath) => {
  const backupPath = createSiblingBackupPath(targetPath);
  let movedExistingTarget = false;
  try {
    await fs.rename(targetPath, backupPath);
    movedExistingTarget = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  try {
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    if (movedExistingTarget) {
      try {
        if (!fsSync.existsSync(targetPath)) await fs.rename(backupPath, targetPath);
        else await fs.rm(backupPath, { force: true });
      } catch {}
    }
    throw err;
  }
  if (movedExistingTarget) {
    try { await fs.rm(backupPath, { force: true }); } catch {}
  }
};

const renameWithBackupSwapSync = (tempPath, targetPath) => {
  const backupPath = createSiblingBackupPath(targetPath);
  let movedExistingTarget = false;
  try {
    fsSync.renameSync(targetPath, backupPath);
    movedExistingTarget = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  try {
    fsSync.renameSync(tempPath, targetPath);
  } catch (err) {
    if (movedExistingTarget) {
      try {
        if (!fsSync.existsSync(targetPath)) fsSync.renameSync(backupPath, targetPath);
        else fsSync.rmSync(backupPath, { force: true });
      } catch {}
    }
    throw err;
  }
  if (movedExistingTarget) {
    try { fsSync.rmSync(backupPath, { force: true }); } catch {}
  }
};

export const replaceFile = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const backupPath = createSiblingBackupPath(finalPath);
  const isSamePath = (
    typeof tempPath === 'string'
    && typeof finalPath === 'string'
    && areComparablePathsEqual(tempPath, finalPath)
  );
  if (isSamePath) {
    if (fsSync.existsSync(finalPath)) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const finalExists = fsSync.existsSync(finalPath);
  if (finalExists) {
    let finalStat = null;
    try { finalStat = await fs.lstat(finalPath); } catch {}
    if (finalStat?.isDirectory?.()) {
      const err = new Error(`Final path is a directory; file replace requires a file target: ${finalPath}`);
      err.code = 'EISDIR';
      throw err;
    }
  }
  const finalExistedAtStart = finalExists;
  let backupAvailable = false;
  let backupCreatedForReplace = false;
  const committedFinalGraceMs = resolveCommittedFinalGraceWithTempWaitMs();
  const commitSucceeded = () => {
    if (!fsSync.existsSync(finalPath)) return false;
    if (!backupCreatedForReplace) {
      return finalExistedAtStart === false || hasRecentlyCommittedFinalPath(finalPath, committedFinalGraceMs);
    }
    return !fsSync.existsSync(backupPath);
  };
  const restoreBackup = async () => {
    if (!backupAvailable || !backupCreatedForReplace) return false;
    if (fsSync.existsSync(finalPath) || !fsSync.existsSync(backupPath)) return false;
    try {
      await fs.rename(backupPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
      return true;
    } catch {
      return false;
    }
  };
  if (!(await waitForPath(tempPath, {
    attempts: REPLACE_TEMP_WAIT_ATTEMPTS,
    baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS
  }))) {
    if (commitSucceeded()) return;
    if (await restoreBackup()) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const copyFallback = async (reasonCode = null) => {
    try {
      await copyFileWithDurability(tempPath, finalPath);
      await fs.rm(tempPath, { force: true });
      maybeReportExdevFallback(options, reasonCode);
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await renameWithRetry(finalPath, backupPath, {
        attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
        baseDelayMs: REPLACE_FILE_RENAME_BASE_DELAY_MS,
        retryableCodes: RETRYABLE_FILE_RENAME_CODES
      });
      backupAvailable = true;
      backupCreatedForReplace = true;
    } catch (err) {
      let handled = false;
      if (err?.code === 'EXDEV') {
        try {
          await fs.copyFile(finalPath, backupPath);
          await fs.rm(finalPath, { force: true });
          backupAvailable = true;
          backupCreatedForReplace = true;
          maybeReportExdevFallback(options, err.code);
          handled = true;
        } catch {
          throw err;
        }
      }
      if (!handled && err?.code !== 'ENOENT') throw err;
    }
  }
  try {
    await renameWithRetry(tempPath, finalPath, {
      attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
      baseDelayMs: REPLACE_FILE_RENAME_BASE_DELAY_MS,
      retryableCodes: RETRYABLE_FILE_RENAME_CODES
    });
    await cleanupBackupIfNeeded({
      keepBackup,
      backupAvailable: backupAvailable && backupCreatedForReplace,
      bakPath: backupPath
    });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      if (commitSucceeded()) {
        await cleanupBackupIfNeeded({
          keepBackup,
          backupAvailable: backupAvailable && backupCreatedForReplace,
          bakPath: backupPath
        });
        return;
      }
      if (await waitForPath(tempPath, {
        attempts: REPLACE_TEMP_WAIT_ATTEMPTS,
        baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS
      })) {
        try {
          await renameWithRetry(tempPath, finalPath, {
            attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
            baseDelayMs: REPLACE_FILE_RENAME_BASE_DELAY_MS,
            retryableCodes: RETRYABLE_FILE_RENAME_CODES
          });
        } catch (retryErr) {
          if (retryErr?.code === 'ENOENT' && commitSucceeded()) {
            await cleanupBackupIfNeeded({
              keepBackup,
              backupAvailable: backupAvailable && backupCreatedForReplace,
              bakPath: backupPath
            });
            return;
          }
          await restoreBackup();
          throw retryErr;
        }
        await cleanupBackupIfNeeded({
          keepBackup,
          backupAvailable: backupAvailable && backupCreatedForReplace,
          bakPath: backupPath
        });
        return;
      }
      if (await restoreBackup()) return;
      const missingErr = new Error(`Temp file missing before replace: ${tempPath}`);
      missingErr.code = 'ERR_TEMP_MISSING';
      throw missingErr;
    }
    if (!RETRYABLE_FILE_RENAME_CODES.has(err?.code)) {
      await restoreBackup();
      throw err;
    }
    if (!backupAvailable) {
      if (finalExistedAtStart) {
        await restoreBackup();
        throw err;
      }
      if (await copyFallback(err?.code || null)) return;
      throw err;
    }
    try { await fs.rm(finalPath, { force: true }); } catch {}
    try {
      await renameWithBackupSwap(tempPath, finalPath);
      await cleanupBackupIfNeeded({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath: backupPath
      });
    } catch (renameErr) {
      if (await copyFallback(renameErr?.code || err?.code || null)) return;
      await restoreBackup();
      throw renameErr;
    }
  }
};

export const replaceFileSync = (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const backupPath = createSiblingBackupPath(finalPath);
  const committedFinalGraceMs = resolveCommittedFinalGraceWithTempWaitMs();
  const isSamePath = (
    typeof tempPath === 'string'
    && typeof finalPath === 'string'
    && areComparablePathsEqual(tempPath, finalPath)
  );
  if (isSamePath) {
    if (fsSync.existsSync(finalPath)) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const finalExists = fsSync.existsSync(finalPath);
  if (finalExists) {
    let finalStat = null;
    try { finalStat = fsSync.lstatSync(finalPath); } catch {}
    if (finalStat?.isDirectory?.()) {
      const err = new Error(`Final path is a directory; file replace requires a file target: ${finalPath}`);
      err.code = 'EISDIR';
      throw err;
    }
  }
  const finalExistedAtStart = finalExists;
  let backupAvailable = false;
  let backupCreatedForReplace = false;
  const commitSucceeded = () => {
    if (!fsSync.existsSync(finalPath)) return false;
    if (!backupCreatedForReplace) {
      return finalExistedAtStart === false || hasRecentlyCommittedFinalPath(finalPath, committedFinalGraceMs);
    }
    return !fsSync.existsSync(backupPath);
  };
  if (!fsSync.existsSync(tempPath)) {
    if (commitSucceeded()) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const restoreBackup = () => {
    if (!backupAvailable || !backupCreatedForReplace) return false;
    if (fsSync.existsSync(finalPath) || !fsSync.existsSync(backupPath)) return false;
    try {
      fsSync.renameSync(backupPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
      return true;
    } catch {
      return false;
    }
  };
  const copyFallback = (reasonCode = null) => {
    try {
      copyFileWithDurabilitySync(tempPath, finalPath);
      fsSync.rmSync(tempPath, { force: true });
      maybeReportExdevFallback(options, reasonCode);
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists) {
    try {
      renameWithRetrySync(finalPath, backupPath, {
        attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
        retryableCodes: RETRYABLE_FILE_RENAME_CODES
      });
      backupAvailable = true;
      backupCreatedForReplace = true;
    } catch (err) {
      let handled = false;
      if (err?.code === 'EXDEV') {
        try {
          fsSync.copyFileSync(finalPath, backupPath);
          fsSync.rmSync(finalPath, { force: true });
          backupAvailable = true;
          backupCreatedForReplace = true;
          maybeReportExdevFallback(options, err.code);
          handled = true;
        } catch {
          throw err;
        }
      }
      if (!handled && err?.code !== 'ENOENT') throw err;
    }
  }
  try {
    renameWithRetrySync(tempPath, finalPath, {
      attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
      retryableCodes: RETRYABLE_FILE_RENAME_CODES
    });
    cleanupBackupIfNeededSync({
      keepBackup,
      backupAvailable: backupAvailable && backupCreatedForReplace,
      bakPath: backupPath
    });
  } catch (err) {
    if (err?.code === 'ENOENT' && commitSucceeded()) {
      cleanupBackupIfNeededSync({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath: backupPath
      });
      return;
    }
    if (!RETRYABLE_FILE_RENAME_CODES.has(err?.code)) {
      restoreBackup();
      throw err;
    }
    if (!backupAvailable) {
      if (finalExists) {
        restoreBackup();
        throw err;
      }
      if (copyFallback(err?.code || null)) return;
      throw err;
    }
    try { fsSync.rmSync(finalPath, { force: true }); } catch {}
    try {
      renameWithBackupSwapSync(tempPath, finalPath);
      cleanupBackupIfNeededSync({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath: backupPath
      });
    } catch (renameErr) {
      if (copyFallback(renameErr?.code || err?.code || null)) return;
      restoreBackup();
      throw renameErr;
    }
  }
};
