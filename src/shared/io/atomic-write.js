import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceFile, replaceFileSync } from './atomic-persistence.js';
import { joinPathSafe, normalizePathForPlatform } from '../path-normalize.js';

const DIR_SYNC_UNSUPPORTED_CODES = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'EMFILE', 'ENFILE']);
const OPEN_RETRY_CODES = new Set(['EMFILE', 'ENFILE']);
const OPEN_RETRY_ATTEMPTS = 10;
const OPEN_RETRY_BASE_DELAY_MS = 10;
let exdevRenameFallbackCount = 0;

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

const removeTempPathSync = (tempPath) => {
  if (!tempPath) return;
  try {
    fsSync.rmSync(tempPath, { force: true });
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

/**
 * Write payload to a temporary sibling file, fsync it, rename into place, and
 * fsync the parent directory to maximize durability across crashes.
 *
 * This is the shared primitive used by `atomicWriteText` and
 * `atomicWriteJson`; it also retries open calls for transient FD exhaustion.
 *
 * @param {string} targetPath
 * @param {string|Buffer} payload
 * @param {{mkdir?:boolean,mode?:number,encoding?:string}} [options]
 * @returns {Promise<string|null>}
 */
const writeAtomicPayload = async (targetPath, payload, {
  mkdir = true,
  mode = undefined,
  encoding = 'utf8'
} = {}) => {
  if (!targetPath) return null;
  const normalizedTargetPath = normalizePathForPlatform(targetPath);
  if (!normalizedTargetPath) {
    throw createAtomicWriteError('normalize target path', String(targetPath || ''), new Error('Invalid target path.'));
  }
  const targetAbsolutePath = path.resolve(normalizedTargetPath);
  const parent = path.dirname(targetAbsolutePath);
  const safeTargetPath = joinPathSafe(parent, [path.basename(targetAbsolutePath)]);
  if (!safeTargetPath) {
    throw createAtomicWriteError('validate target path', targetAbsolutePath, new Error('Target path escaped parent boundary.'));
  }
  if (mkdir) {
    await fs.mkdir(parent, { recursive: true });
  }
  const tempPath = createTempPath(safeTargetPath);
  if (mkdir && tempPath) {
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
  }
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
    await replaceFile(tempPath, safeTargetPath, {
      keepBackup: false,
      onExdevFallback: () => {
        exdevRenameFallbackCount += 1;
      }
    });
    await syncParentDirectory(safeTargetPath);
    return safeTargetPath;
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    await removeTempPath(tempPath);
    throw createAtomicWriteError('write file atomically', safeTargetPath, err);
  }
};

const syncParentDirectorySync = (targetPath) => {
  let fd = null;
  try {
    fd = fsSync.openSync(path.dirname(targetPath), 'r');
    fsSync.fsyncSync(fd);
  } catch (err) {
    if (!DIR_SYNC_UNSUPPORTED_CODES.has(err?.code)) {
      throw err;
    }
  } finally {
    if (fd != null) {
      try { fsSync.closeSync(fd); } catch {}
    }
  }
};

/**
 * Synchronous variant of atomic payload write (temp file -> fsync -> rename).
 *
 * @param {string} targetPath
 * @param {string|Buffer} payload
 * @param {{mkdir?:boolean,mode?:number,encoding?:string,durable?:boolean}} [options]
 * @returns {string|null}
 */
const writeAtomicPayloadSync = (targetPath, payload, {
  mkdir = true,
  mode = undefined,
  encoding = 'utf8',
  durable = true
} = {}) => {
  if (!targetPath) return null;
  const normalizedTargetPath = normalizePathForPlatform(targetPath);
  if (!normalizedTargetPath) {
    throw createAtomicWriteError('normalize target path', String(targetPath || ''), new Error('Invalid target path.'));
  }
  const targetAbsolutePath = path.resolve(normalizedTargetPath);
  const parent = path.dirname(targetAbsolutePath);
  const safeTargetPath = joinPathSafe(parent, [path.basename(targetAbsolutePath)]);
  if (!safeTargetPath) {
    throw createAtomicWriteError('validate target path', targetAbsolutePath, new Error('Target path escaped parent boundary.'));
  }
  if (mkdir) {
    fsSync.mkdirSync(parent, { recursive: true });
  }
  const tempPath = createTempPath(safeTargetPath);
  if (mkdir && tempPath) {
    fsSync.mkdirSync(path.dirname(tempPath), { recursive: true });
  }
  let fd = null;
  try {
    fd = mode == null
      ? fsSync.openSync(tempPath, 'wx')
      : fsSync.openSync(tempPath, 'wx', mode);
    if (Buffer.isBuffer(payload)) {
      fsSync.writeFileSync(fd, payload);
    } else {
      fsSync.writeFileSync(fd, String(payload), { encoding });
    }
    if (durable !== false) {
      fsSync.fsyncSync(fd);
    }
    fsSync.closeSync(fd);
    fd = null;
    replaceFileSync(tempPath, safeTargetPath, {
      keepBackup: false,
      onExdevFallback: () => {
        exdevRenameFallbackCount += 1;
      }
    });
    if (durable !== false) {
      syncParentDirectorySync(safeTargetPath);
    }
    return safeTargetPath;
  } catch (err) {
    if (fd != null) {
      try { fsSync.closeSync(fd); } catch {}
    }
    removeTempPathSync(tempPath);
    throw createAtomicWriteError('write file atomically', safeTargetPath, err);
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
    ? (() => {
      if (!newline) return text;
      if (text.length > 0 && text[text.length - 1] === 0x0a) return text;
      return Buffer.concat([text, Buffer.from('\n')]);
    })()
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

/**
 * Atomically write UTF-8 text to disk synchronously.
 * @param {string} targetPath
 * @param {string|Buffer} text
 * @param {{mkdir?:boolean,mode?:number,encoding?:string,newline?:boolean,durable?:boolean}} [options]
 * @returns {string|null}
 */
export const atomicWriteTextSync = (targetPath, text, options = {}) => {
  const {
    newline = false,
    encoding = 'utf8'
  } = options;
  const payload = Buffer.isBuffer(text)
    ? (() => {
      if (!newline) return text;
      if (text.length > 0 && text[text.length - 1] === 0x0a) return text;
      return Buffer.concat([text, Buffer.from('\n')]);
    })()
    : (() => {
      const source = text == null ? '' : String(text);
      if (!newline) return source;
      return source.endsWith('\n') ? source : `${source}\n`;
    })();
  return writeAtomicPayloadSync(targetPath, payload, { ...options, encoding });
};

/**
 * Atomically serialize and write JSON to disk synchronously.
 * @param {string} targetPath
 * @param {any} value
 * @param {{mkdir?:boolean,mode?:number,spaces?:number,replacer?:((this:any,key:string,value:any)=>any)|Array<string|number>|null,newline?:boolean,durable?:boolean}} [options]
 * @returns {string|null}
 */
export const atomicWriteJsonSync = (targetPath, value, options = {}) => {
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
  return writeAtomicPayloadSync(
    targetPath,
    newline ? `${payload}\n` : payload,
    options
  );
};

export const getAtomicWriteRuntimeMetrics = () => ({
  exdevRenameFallbackCount
});

export const resetAtomicWriteRuntimeMetricsForTests = () => {
  exdevRenameFallbackCount = 0;
};
