import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import {
  REPLACE_DIR_RENAME_ATTEMPTS,
  REPLACE_DIR_RENAME_BASE_DELAY_MS,
  RETRYABLE_DIR_RENAME_CODES,
  sleep,
  syncParentDirectory,
  createSiblingBackupPath
} from './persistence-helpers.js';
import { createTempPath } from './temp-path.js';

const renameWithRetries = async (fromPath, toPath) => {
  for (let attempt = 0; attempt < REPLACE_DIR_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(fromPath, toPath);
      return;
    } catch (err) {
      const retryable = RETRYABLE_DIR_RENAME_CODES.has(err?.code);
      if (!retryable || attempt >= REPLACE_DIR_RENAME_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(REPLACE_DIR_RENAME_BASE_DELAY_MS * (attempt + 1));
    }
  }
};

export const replaceDir = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const bakPath = createSiblingBackupPath(finalPath);
  const finalExists = fsSync.existsSync(finalPath);
  if (!fsSync.existsSync(tempPath)) {
    const err = new Error(`Temp dir missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  let backupAvailable = false;
  let backupCreatedForReplace = false;
  const restoreBackup = async () => {
    if (!backupAvailable || !backupCreatedForReplace) return;
    const rollbackCurrentPath = createTempPath(`${finalPath}.restore-current`, { preferFallback: true });
    let movedCurrentAside = false;
    if (fsSync.existsSync(finalPath)) {
      try {
        await renameWithRetries(finalPath, rollbackCurrentPath);
        movedCurrentAside = true;
      } catch {
        movedCurrentAside = false;
      }
    }
    try {
      await fs.rename(bakPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
      if (movedCurrentAside) {
        try { await fs.rm(rollbackCurrentPath, { recursive: true, force: true }); } catch {}
      }
    } catch {}
    if (movedCurrentAside && !fsSync.existsSync(finalPath)) {
      try { await renameWithRetries(rollbackCurrentPath, finalPath); } catch {}
    }
  };
  const copyDirFallback = async () => {
    const stagedPath = createTempPath(`${finalPath}.staged`, { preferFallback: true });
    const rollbackPath = createTempPath(`${finalPath}.rollback`, { preferFallback: true });
    const cleanupDir = async (targetPath) => {
      try { await fs.rm(targetPath, { recursive: true, force: true }); } catch {}
    };
    await cleanupDir(stagedPath);
    await cleanupDir(rollbackPath);
    try {
      await fs.cp(tempPath, stagedPath, { recursive: true, force: true, errorOnExist: false });
      if (fsSync.existsSync(finalPath)) {
        try {
          await renameWithRetries(finalPath, rollbackPath);
        } catch {
          await cleanupDir(stagedPath);
          return false;
        }
      }
      try {
        await renameWithRetries(stagedPath, finalPath);
      } catch {
        if (!fsSync.existsSync(finalPath) && fsSync.existsSync(rollbackPath)) {
          try { await renameWithRetries(rollbackPath, finalPath); } catch {}
        }
        await cleanupDir(stagedPath);
        return false;
      }
      try { await syncParentDirectory(finalPath); } catch {}
      await cleanupDir(rollbackPath);
      await fs.rm(tempPath, { recursive: true, force: true });
      return true;
    } catch {
      await cleanupDir(stagedPath);
      if (!fsSync.existsSync(finalPath) && fsSync.existsSync(rollbackPath)) {
        try { await renameWithRetries(rollbackPath, finalPath); } catch {}
      }
      await cleanupDir(rollbackPath);
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await renameWithRetries(finalPath, bakPath);
      backupAvailable = true;
      backupCreatedForReplace = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  try {
    await renameWithRetries(tempPath, finalPath);
    try { await syncParentDirectory(finalPath); } catch {}
    if (!keepBackup && backupAvailable) {
      try { await fs.rm(bakPath, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    if (!RETRYABLE_DIR_RENAME_CODES.has(err?.code)) {
      await restoreBackup();
      throw err;
    }
    try {
      await renameWithRetries(tempPath, finalPath);
      try { await syncParentDirectory(finalPath); } catch {}
      if (!keepBackup && backupAvailable) {
        try { await fs.rm(bakPath, { recursive: true, force: true }); } catch {}
      }
    } catch (renameErr) {
      if (await copyDirFallback()) {
        if (!keepBackup && backupAvailable) {
          try { await fs.rm(bakPath, { recursive: true, force: true }); } catch {}
        }
        return;
      }
      await restoreBackup();
      throw renameErr;
    }
  }
};
