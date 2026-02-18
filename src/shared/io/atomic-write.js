import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempPath } from '../json-stream/atomic.js';

const RENAME_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV']);
const DIR_SYNC_UNSUPPORTED_CODES = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'EMFILE', 'ENFILE']);
const OPEN_RETRY_CODES = new Set(['EMFILE', 'ENFILE']);
const OPEN_RETRY_ATTEMPTS = 6;
const OPEN_RETRY_BASE_DELAY_MS = 10;

const toNonNegativeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const createAtomicWriteError = (operation, targetPath, err) => {
  const wrapped = new Error(
    `[atomic-write] Failed to ${operation} "${targetPath}": ${err?.message || String(err)}`
  );
  wrapped.code = 'ERR_ATOMIC_WRITE';
  wrapped.operation = operation;
  wrapped.path = targetPath;
  wrapped.cause = err;
  wrapped.causeCode = err?.code || null;
  return wrapped;
};

const removeTempPath = async (tempPath) => {
  if (!tempPath) return;
  try {
    await fs.rm(tempPath, { force: true });
  } catch {}
};

const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Retry transient descriptor exhaustion (EMFILE/ENFILE) when creating temp files.
 * This keeps atomic writes resilient under short-lived FD pressure spikes.
 */
const openWithRetry = async (filePath, flags, mode) => {
  let attempts = 0;
  while (true) {
    try {
      return mode == null
        ? await fs.open(filePath, flags)
        : await fs.open(filePath, flags, mode);
    } catch (err) {
      attempts += 1;
      if (!OPEN_RETRY_CODES.has(err?.code) || attempts >= OPEN_RETRY_ATTEMPTS) {
        throw err;
      }
      const delayMs = Math.min(250, OPEN_RETRY_BASE_DELAY_MS * (2 ** (attempts - 1)));
      await sleep(delayMs);
    }
  }
};

const syncParentDirectory = async (targetPath) => {
  let dirHandle = null;
  try {
    dirHandle = await fs.open(path.dirname(targetPath), 'r');
    await dirHandle.sync();
  } catch (err) {
    if (!DIR_SYNC_UNSUPPORTED_CODES.has(err?.code)) {
      throw err;
    }
  } finally {
    if (dirHandle) {
      try { await dirHandle.close(); } catch {}
    }
  }
};

const renameTempFile = async (tempPath, targetPath) => {
  try {
    await fs.rename(tempPath, targetPath);
    return;
  } catch (err) {
    if (!RENAME_RETRY_CODES.has(err?.code)) {
      throw err;
    }
  }
  try {
    await fs.rm(targetPath, { force: true });
  } catch {}
  await fs.rename(tempPath, targetPath);
};

const writeAtomicPayload = async (targetPath, payload, {
  mkdir = true,
  mode = undefined,
  encoding = 'utf8'
} = {}) => {
  if (!targetPath) return null;
  const parent = path.dirname(targetPath);
  if (mkdir) {
    await fs.mkdir(parent, { recursive: true });
  }
  const tempPath = createTempPath(targetPath);
  let handle = null;
  try {
    handle = await openWithRetry(tempPath, 'wx', mode);
    if (Buffer.isBuffer(payload)) {
      await handle.writeFile(payload);
    } else {
      await handle.writeFile(String(payload), { encoding });
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await renameTempFile(tempPath, targetPath);
    await syncParentDirectory(targetPath);
    return targetPath;
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    await removeTempPath(tempPath);
    throw createAtomicWriteError('write file atomically', targetPath, err);
  }
};

/**
 * Atomically write UTF-8 text to disk (temp file -> fsync -> rename).
 * @param {string} targetPath
 * @param {string|Buffer} text
 * @param {{mkdir?:boolean,mode?:number,encoding?:string,newline?:boolean}} [options]
 * @returns {Promise<string|null>}
 */
export const atomicWriteText = async (targetPath, text, options = {}) => {
  const {
    newline = false,
    encoding = 'utf8'
  } = options;
  const payload = Buffer.isBuffer(text)
    ? text
    : (() => {
      const source = text == null ? '' : String(text);
      if (!newline) return source;
      return source.endsWith('\n') ? source : `${source}\n`;
    })();
  return writeAtomicPayload(targetPath, payload, { ...options, encoding });
};

/**
 * Atomically serialize and write JSON to disk.
 * @param {string} targetPath
 * @param {any} value
 * @param {{mkdir?:boolean,mode?:number,spaces?:number,replacer?:((this:any,key:string,value:any)=>any)|Array<string|number>|null,newline?:boolean}} [options]
 * @returns {Promise<string|null>}
 */
export const atomicWriteJson = async (targetPath, value, options = {}) => {
  const {
    replacer = null,
    spaces = 2,
    newline = true
  } = options;
  const resolvedSpaces = toNonNegativeInt(spaces, 2);
  let payload = null;
  try {
    payload = JSON.stringify(value, replacer, resolvedSpaces);
  } catch (err) {
    throw createAtomicWriteError('serialize JSON', targetPath, err);
  }
  if (payload === undefined) {
    const err = new Error('JSON payload resolved to undefined.');
    throw createAtomicWriteError('serialize JSON', targetPath, err);
  }
  return writeAtomicPayload(
    targetPath,
    newline ? `${payload}\n` : payload,
    options
  );
};
