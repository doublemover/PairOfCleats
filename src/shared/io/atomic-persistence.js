import fsSync from 'node:fs';
import fs from 'node:fs/promises';
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

// Keep headroom for sidecar paths (e.g. SQLite -wal/-journal suffixes) on Win32.
const WINDOWS_PATH_BUDGET = 240;
const MIN_COMPACT_TOKEN_CHARS = 12;
const REPLACE_TEMP_WAIT_ATTEMPTS = 20;
const REPLACE_TEMP_WAIT_BASE_DELAY_MS = 25;
const REPLACE_FILE_RENAME_RETRY_ATTEMPTS = 10;
const REPLACE_FILE_RENAME_BASE_DELAY_MS = 20;
const REPLACE_DIR_RENAME_ATTEMPTS = 10;
const REPLACE_DIR_RENAME_BASE_DELAY_MS = 20;
const LONG_PATH_PREFIX = '\\\\?\\';
const RETRYABLE_FILE_RENAME_CODES = new Set([
  'EEXIST',
  'EPERM',
  'ENOTEMPTY',
  'EACCES',
  'EXDEV',
  'EBUSY'
]);
const RETRYABLE_DIR_RENAME_CODES = new Set([
  'EEXIST',
  'EPERM',
  'ENOTEMPTY',
  'EACCES',
  'EXDEV',
  'EBUSY'
]);

const stripLongPathPrefix = (value) => (
  typeof value === 'string' && value.startsWith(LONG_PATH_PREFIX)
    ? value.slice(LONG_PATH_PREFIX.length)
    : value
);

const toComparablePath = (value) => path.resolve(stripLongPathPrefix(value));

const areComparablePathsEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  try {
    return toComparablePath(left) === toComparablePath(right);
  } catch {
    return false;
  }
};

const waitForPath = async (targetPath, { attempts = 3, baseDelayMs = 10 } = {}) => {
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

const safeStat = async (targetPath) => {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
};

export const createTempPath = (filePath, options = {}) => {
  const preferFallback = options?.preferFallback === true;
  const token = createTempToken();
  const suffix = `.tmp-${token}`;
  const tempPath = `${filePath}${suffix}`;
  if (process.platform !== 'win32' || tempPath.length <= WINDOWS_PATH_BUDGET) {
    return tempPath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const compactToken = crypto
    .createHash('sha256')
    .update(filePath)
    .update(':')
    .update(token)
    .digest('hex');

  const buildCompactPathInDir = (baseDir, maxLen, withExt = true) => {
    const suffixExt = withExt ? ext : '';
    // Preserve the ".tmp-" marker so cleanup/discovery logic remains consistent.
    const prefix = 't.tmp-';
    const budget = maxLen - baseDir.length - 1 - prefix.length - suffixExt.length;
    if (budget < MIN_COMPACT_TOKEN_CHARS) return null;
    const tokenBudget = Math.min(compactToken.length, budget);
    const name = `${prefix}${compactToken.slice(0, tokenBudget)}`;
    return path.join(baseDir, `${name}${suffixExt}`);
  };

  /**
   * Return true when we can create files under the candidate directory.
   * For non-existent directories, check the nearest existing ancestor.
   */
  const isCandidateDirWritable = (candidateDir) => {
    if (typeof candidateDir !== 'string' || !candidateDir) return false;
    let probe = candidateDir;
    while (!fsSync.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (!parent || parent === probe) return false;
      probe = parent;
    }
    try {
      fsSync.accessSync(probe, fsSync.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };

  const buildCompactPathInAncestors = (maxLen, withExt = true) => {
    let baseDir = dir;
    while (baseDir) {
      const candidate = buildCompactPathInDir(baseDir, maxLen, withExt);
      if (candidate && isCandidateDirWritable(baseDir)) return candidate;
      const parent = path.dirname(baseDir);
      if (!parent || parent === baseDir) break;
      baseDir = parent;
    }
    return null;
  };

  const buildFallbackTempPath = (withExt = true) => {
    const suffixExt = withExt ? ext : '';
    const baseDir = path.join(process.env.TEMP || process.env.TMP || path.join(process.cwd(), '.tmp'), 'poc-atomic');
    const name = `t.tmp-${compactToken}`;
    if (!isCandidateDirWritable(baseDir)) return null;
    return path.join(baseDir, `${name}${suffixExt}`);
  };

  const compactCandidate = preferFallback
    ? null
    : (
      buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, true)
      || buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, false)
    );
  return compactCandidate
    || buildFallbackTempPath(true)
    || buildFallbackTempPath(false)
    || tempPath;
};

const getBakPath = (filePath) => `${filePath}.bak`;

const createSiblingBackupPath = (targetPath) => {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const entropy = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return path.join(dir, `.${base}.bak-${entropy}`);
};

const cleanupBackupIfNeeded = async ({ keepBackup, backupAvailable, bakPath }) => {
  if (keepBackup || !backupAvailable) return;
  try {
    await fs.rm(bakPath, { force: true });
  } catch {}
};

const cleanupBackupIfNeededSync = ({ keepBackup, backupAvailable, bakPath }) => {
  if (keepBackup || !backupAvailable) return;
  try {
    fsSync.rmSync(bakPath, { force: true });
  } catch {}
};

const renameWithRetry = async (fromPath, toPath, {
  attempts = REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
  baseDelayMs = REPLACE_FILE_RENAME_BASE_DELAY_MS,
  retryableCodes = RETRYABLE_FILE_RENAME_CODES
} = {}) => {
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

const renameWithRetrySync = (fromPath, toPath, {
  attempts = REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
  retryableCodes = RETRYABLE_FILE_RENAME_CODES
} = {}) => {
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

const renameWithBackupSwap = async (tempPath, targetPath) => {
  const backupPath = createSiblingBackupPath(targetPath);
  let movedExistingTarget = false;
  try {
    await fs.rename(targetPath, backupPath);
    movedExistingTarget = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }
  try {
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    if (movedExistingTarget) {
      try {
        if (!fsSync.existsSync(targetPath)) {
          await fs.rename(backupPath, targetPath);
        } else {
          await fs.rm(backupPath, { force: true });
        }
      } catch {}
    }
    throw err;
  }
  if (movedExistingTarget) {
    try {
      await fs.rm(backupPath, { force: true });
    } catch {}
  }
};

const renameWithBackupSwapSync = (tempPath, targetPath) => {
  const backupPath = createSiblingBackupPath(targetPath);
  let movedExistingTarget = false;
  try {
    fsSync.renameSync(targetPath, backupPath);
    movedExistingTarget = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }
  try {
    fsSync.renameSync(tempPath, targetPath);
  } catch (err) {
    if (movedExistingTarget) {
      try {
        if (!fsSync.existsSync(targetPath)) {
          fsSync.renameSync(backupPath, targetPath);
        } else {
          fsSync.rmSync(backupPath, { force: true });
        }
      } catch {}
    }
    throw err;
  }
  if (movedExistingTarget) {
    try {
      fsSync.rmSync(backupPath, { force: true });
    } catch {}
  }
};

const maybeReportExdevFallback = (options = {}, reasonCode = null) => {
  if (reasonCode !== 'EXDEV') return;
  if (typeof options.onExdevFallback === 'function') {
    try {
      options.onExdevFallback();
    } catch {}
  }
};

export const replaceFile = async (tempPath, finalPath, options = {}) => {
  const startedAt = Date.now();
  const keepBackup = options.keepBackup === true;
  const bakPath = getBakPath(finalPath);
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
    try {
      finalStat = await fs.lstat(finalPath);
    } catch {}
    if (finalStat?.isDirectory?.()) {
      const err = new Error(`Final path is a directory; file replace requires a file target: ${finalPath}`);
      err.code = 'EISDIR';
      throw err;
    }
  }
  const isFreshFinal = async () => {
    const stat = await safeStat(finalPath);
    return Boolean(stat && stat.mtimeMs >= startedAt - 2000);
  };
  const finalExistedAtStart = finalExists;
  let backupAvailable = fsSync.existsSync(bakPath);
  let backupCreatedForReplace = false;
  const restoreBackup = async () => {
    if (!backupAvailable || !backupCreatedForReplace) return false;
    if (fsSync.existsSync(finalPath) || !fsSync.existsSync(bakPath)) return false;
    try {
      await fs.rename(bakPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
      return true;
    } catch {
      return false;
    }
  };
  const canTreatExistingFinalAsCommitted = async () => {
    if (!fsSync.existsSync(finalPath)) return false;
    if (!finalExistedAtStart) return true;
    return isFreshFinal();
  };
  if (!(await waitForPath(tempPath, {
    attempts: REPLACE_TEMP_WAIT_ATTEMPTS,
    baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS
  }))) {
    if (await canTreatExistingFinalAsCommitted()) {
      await cleanupBackupIfNeeded({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath
      });
      return;
    }
    if (await restoreBackup()) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const copyFallback = async (reasonCode = null) => {
    try {
      await fs.copyFile(tempPath, finalPath);
      await fs.rm(tempPath, { force: true });
      maybeReportExdevFallback(options, reasonCode);
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      await fs.rename(finalPath, bakPath);
      backupAvailable = true;
      backupCreatedForReplace = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fsSync.existsSync(bakPath);
      }
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
      bakPath
    });
  } catch (err) {
    if (err?.code === 'ENOENT') {
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
          await restoreBackup();
          throw retryErr;
        }
        await cleanupBackupIfNeeded({
          keepBackup,
          backupAvailable: backupAvailable && backupCreatedForReplace,
          bakPath
        });
        return;
      }
      if (await canTreatExistingFinalAsCommitted()) {
        await cleanupBackupIfNeeded({
          keepBackup,
          backupAvailable: backupAvailable && backupCreatedForReplace,
          bakPath
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
      if (await copyFallback(err?.code || null)) return;
      throw err;
    }
    try {
      await fs.rm(finalPath, { force: true });
    } catch {}
    try {
      await renameWithBackupSwap(tempPath, finalPath);
      await cleanupBackupIfNeeded({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath
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
  const bakPath = getBakPath(finalPath);
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
  if (!fsSync.existsSync(tempPath)) {
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const finalExists = fsSync.existsSync(finalPath);
  if (finalExists) {
    let finalStat = null;
    try {
      finalStat = fsSync.lstatSync(finalPath);
    } catch {}
    if (finalStat?.isDirectory?.()) {
      const err = new Error(`Final path is a directory; file replace requires a file target: ${finalPath}`);
      err.code = 'EISDIR';
      throw err;
    }
  }
  let backupAvailable = fsSync.existsSync(bakPath);
  let backupCreatedForReplace = false;
  const restoreBackup = () => {
    if (!backupAvailable || !backupCreatedForReplace) return false;
    if (fsSync.existsSync(finalPath) || !fsSync.existsSync(bakPath)) return false;
    try {
      fsSync.renameSync(bakPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
      return true;
    } catch {
      return false;
    }
  };
  const copyFallback = (reasonCode = null) => {
    try {
      fsSync.copyFileSync(tempPath, finalPath);
      fsSync.rmSync(tempPath, { force: true });
      maybeReportExdevFallback(options, reasonCode);
      return true;
    } catch {
      return false;
    }
  };
  if (finalExists && !backupAvailable) {
    try {
      renameWithRetrySync(finalPath, bakPath, {
        attempts: REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
        retryableCodes: RETRYABLE_FILE_RENAME_CODES
      });
      backupAvailable = true;
      backupCreatedForReplace = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fsSync.existsSync(bakPath);
      }
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
      bakPath
    });
  } catch (err) {
    if (!RETRYABLE_FILE_RENAME_CODES.has(err?.code)) {
      restoreBackup();
      throw err;
    }
    if (!backupAvailable) {
      if (copyFallback(err?.code || null)) return;
      throw err;
    }
    try {
      fsSync.rmSync(finalPath, { force: true });
    } catch {}
    try {
      renameWithBackupSwapSync(tempPath, finalPath);
      cleanupBackupIfNeededSync({
        keepBackup,
        backupAvailable: backupAvailable && backupCreatedForReplace,
        bakPath
      });
    } catch (renameErr) {
      if (copyFallback(renameErr?.code || err?.code || null)) return;
      restoreBackup();
      throw renameErr;
    }
  }
};

export const replaceDir = async (tempPath, finalPath, options = {}) => {
  const keepBackup = options.keepBackup === true;
  const bakPath = `${finalPath}.bak`;
  const finalExists = fsSync.existsSync(finalPath);
  if (!fsSync.existsSync(tempPath)) {
    const err = new Error(`Temp dir missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  let backupAvailable = fsSync.existsSync(bakPath);
  let backupCreatedForReplace = false;
  const restoreBackup = async () => {
    if (!backupAvailable || !backupCreatedForReplace) return;
    try {
      if (fsSync.existsSync(finalPath)) {
        await fs.rm(finalPath, { recursive: true, force: true });
      }
    } catch {}
    try {
      await fs.rename(bakPath, finalPath);
      backupAvailable = false;
      backupCreatedForReplace = false;
    } catch {}
  };
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
  const copyDirFallback = async () => {
    const stagedPath = createTempPath(`${finalPath}.staged`, { preferFallback: true });
    const rollbackPath = createTempPath(`${finalPath}.rollback`, { preferFallback: true });
    const cleanupDir = async (targetPath) => {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch {}
    };
    await cleanupDir(stagedPath);
    await cleanupDir(rollbackPath);
    try {
      await fs.cp(tempPath, stagedPath, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
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
      if (err?.code !== 'ENOENT') {
        backupAvailable = fsSync.existsSync(bakPath);
      }
    }
  }
  try {
    await renameWithRetries(tempPath, finalPath);
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
