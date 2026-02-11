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

// Keep headroom for sidecar paths (e.g. SQLite -wal/-journal suffixes) on Win32.
const WINDOWS_PATH_BUDGET = 240;
const MIN_COMPACT_TOKEN_CHARS = 12;
const REPLACE_TEMP_WAIT_ATTEMPTS = 20;
const REPLACE_TEMP_WAIT_BASE_DELAY_MS = 25;
const LONG_PATH_PREFIX = '\\\\?\\';

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
  if (process.platform !== 'win32' || tempPath.length <= WINDOWS_PATH_BUDGET) {
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

  const buildCompactPathInAncestors = (maxLen, withExt = true) => {
    let baseDir = dir;
    while (baseDir) {
      const candidate = buildCompactPathInDir(baseDir, maxLen, withExt);
      if (candidate) return candidate;
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
    return path.join(baseDir, `${name}${suffixExt}`);
  };

  return (
    buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, true)
    || buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, false)
    || buildFallbackTempPath(true)
    || buildFallbackTempPath(false)
    || tempPath
  );
};

const getBakPath = (filePath) => `${filePath}.bak`;

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
    if (fs.existsSync(finalPath)) return;
    const err = new Error(`Temp file missing before replace: ${tempPath}`);
    err.code = 'ERR_TEMP_MISSING';
    throw err;
  }
  const finalExists = fs.existsSync(finalPath);
  const isFreshFinal = async () => {
    const stat = await safeStat(finalPath);
    return Boolean(stat && stat.mtimeMs >= startedAt - 2000);
  };
  const finalExistedAtStart = finalExists;
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
  /**
   * Treat existing final output as committed only when it is either:
   * - newly created during this replace attempt, or
   * - freshly updated after replace started.
   * Stale pre-existing finals (including stale .bak presence) must not be
   * accepted as success when the temp file is missing.
   *
   * @returns {Promise<boolean>}
   */
  const canTreatExistingFinalAsCommitted = async () => {
    if (!fs.existsSync(finalPath)) return false;
    if (!finalExistedAtStart) return true;
    return isFreshFinal();
  };
  if (!(await waitForPath(tempPath, {
    attempts: REPLACE_TEMP_WAIT_ATTEMPTS,
    baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS
  }))) {
    if (await canTreatExistingFinalAsCommitted()) {
      if (!keepBackup && backupAvailable) {
        try { await fsPromises.rm(bakPath, { force: true }); } catch {}
      }
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
      if (await waitForPath(tempPath, {
        attempts: REPLACE_TEMP_WAIT_ATTEMPTS,
        baseDelayMs: REPLACE_TEMP_WAIT_BASE_DELAY_MS
      })) {
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
      if (await canTreatExistingFinalAsCommitted()) {
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
