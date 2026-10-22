import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempPath } from './temp-path.js';
import { replaceFile, replaceFileSync } from './replace-file.js';
import { joinPathSafe, normalizePathForPlatform } from '../path-normalize.js';
import { incAtomicPersistenceFallback } from '../metrics/core.js';
import { throwIfAborted, isAbortError } from '../abort.js';

const DIR_SYNC_UNSUPPORTED_CODES = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'EMFILE', 'ENFILE']);
const OPEN_RETRY_CODES = new Set(['EMFILE', 'ENFILE']);
const OPEN_RETRY_ATTEMPTS = 10;
const OPEN_RETRY_BASE_DELAY_MS = 10;
let exdevRenameFallbackCount = 0;
let lastExdevFallbackAt = null;
let lastExdevFallbackPath = null;

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

const findExistingPathSync = (candidatePath) => {
  if (!candidatePath) return null;
  let current = path.resolve(String(candidatePath));
  while (current) {
    if (fsSync.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
};

const readDeviceIdSync = (candidatePath) => {
  const existingPath = findExistingPathSync(candidatePath);
  if (!existingPath) return null;
  try {
    const stat = fsSync.statSync(existingPath);
    return Number.isFinite(Number(stat?.dev)) ? Number(stat.dev) : null;
  } catch {
    return null;
  }
};

const recordExdevFallback = (targetPath) => {
  exdevRenameFallbackCount += 1;
  lastExdevFallbackAt = new Date().toISOString();
  lastExdevFallbackPath = targetPath || null;
  incAtomicPersistenceFallback({ reason: 'exdev' });
};

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

const resolveAtomicWriteTarget = (targetPath) => {
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
  return { parent, safeTargetPath };
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
 * @param {{mkdir?:boolean,mode?:number,encoding?:string,signal?:AbortSignal,
 * createOnly?:boolean,verifyStaging?:Function,beforeCommit?:Function,verifyPublished?:Function}} [options]
 * @returns {Promise<string|null>}
 */
const writeAtomicPayload = async (targetPath, payload, {
  mkdir = true,
  mode = undefined,
  encoding = 'utf8',
  signal = null,
  createOnly = false,
  verifyStaging = null,
  beforeCommit = null,
  verifyPublished = null,
  writePayload = null
} = {}) => {
  throwIfAborted(signal);
  const resolvedTarget = resolveAtomicWriteTarget(targetPath);
  if (!resolvedTarget) return null;
  const { parent, safeTargetPath } = resolvedTarget;
  if (mkdir) {
    await fs.mkdir(parent, { recursive: true });
  }
  const tempPath = createTempPath(safeTargetPath);
  if (mkdir && tempPath) {
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
  }
  let handle = null;
  let publishedIdentity = null, published = false;
  try {
    handle = await openWithRetry(tempPath, 'wx', mode);
    await verifyStaging?.(handle, tempPath);
    throwIfAborted(signal);
    if (writePayload) {
      await writePayload(handle);
    } else if (Buffer.isBuffer(payload)) {
      await handle.writeFile(payload);
    } else {
      await handle.writeFile(String(payload), { encoding });
    }
    await handle.sync();
    await beforeCommit?.(handle, tempPath);
    throwIfAborted(signal);
    if (createOnly) {
      // Same-directory hard-link publication is atomic and fails if the name
      // already exists. Never fall back to an overwriting rename or copy.
      publishedIdentity = await handle.stat({ bigint: true });
      await fs.link(tempPath, safeTargetPath);
      published = true;
      await verifyPublished?.(handle, safeTargetPath);
      await handle.close();
      handle = null;
      await removeTempPath(tempPath);
    } else {
      await handle.close();
      handle = null;
      await replaceFile(tempPath, safeTargetPath, {
        keepBackup: false,
        signal,
        onExdevFallback: () => {
          recordExdevFallback(safeTargetPath);
        }
      });
    }
    await syncParentDirectory(safeTargetPath);
    return safeTargetPath;
  } catch (err) {
    if (published) {
      // Roll back only the new name that still identifies our opened object.
      // A replacement or link installed by somebody else is never unlinked.
      try {
        const current = await fs.lstat(safeTargetPath, { bigint: true });
        if (!current.isSymbolicLink() && current.dev === publishedIdentity.dev && current.ino === publishedIdentity.ino) {
          await fs.unlink(safeTargetPath);
        }
      } catch {}
    }
    if (handle) {
      try { await handle.close(); } catch {}
    }
    await removeTempPath(tempPath);
    if (isAbortError(err)) throw err;
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
  const resolvedTarget = resolveAtomicWriteTarget(targetPath);
  if (!resolvedTarget) return null;
  const { parent, safeTargetPath } = resolvedTarget;
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
        recordExdevFallback(safeTargetPath);
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

const buildAtomicTextPayload = (text, { newline = false } = {}) => {
  if (Buffer.isBuffer(text)) {
    if (!newline) return text;
    if (text.length > 0 && text[text.length - 1] === 0x0a) return text;
    return Buffer.concat([text, Buffer.from('\n')]);
  }
  const source = text == null ? '' : String(text);
  if (!newline) return source;
  return source.endsWith('\n') ? source : `${source}\n`;
};

const buildAtomicJsonPayload = (targetPath, value, {
  replacer = null,
  spaces = 2,
  newline = true
} = {}) => {
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
  return newline ? `${payload}\n` : payload;
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
  const payload = buildAtomicTextPayload(text, { newline });
  return writeAtomicPayload(targetPath, payload, { ...options, encoding });
};

/**
 * Stream bounded chunks through the same durable temp/fsync/publication owner.
 * A producer callback must await each write and may not retain the writer after
 * returning. Borrowed buffers are consumed before the write promise resolves.
 */
export const atomicWriteChunks = async (targetPath, chunks, options = {}) => {
  return writeAtomicPayload(targetPath, null, {
    ...options,
    writePayload: async (handle) => {
      const write = async (chunk) => {
        throwIfAborted(options.signal);
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.length) {
          throwIfAborted(options.signal);
          const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
          if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > buffer.length - offset) {
            throw new Error('Atomic chunk write made invalid progress.');
          }
          offset += bytesWritten;
        }
      };
      if (typeof chunks === 'function') await chunks(write);
      else for await (const chunk of chunks) await write(chunk);
    }
  });
};

/**
 * Atomically serialize and write JSON to disk.
 * @param {string} targetPath
 * @param {any} value
 * @param {{mkdir?:boolean,mode?:number,spaces?:number,replacer?:((this:any,key:string,value:any)=>any)|Array<string|number>|null,newline?:boolean}} [options]
 * @returns {Promise<string|null>}
 */
export const atomicWriteJson = async (targetPath, value, options = {}) => {
  return writeAtomicPayload(targetPath, buildAtomicJsonPayload(targetPath, value, options), options);
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
  const payload = buildAtomicTextPayload(text, { newline });
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
  return writeAtomicPayloadSync(targetPath, buildAtomicJsonPayload(targetPath, value, options), options);
};

export const getAtomicWriteRuntimeMetrics = () => ({
  degradedDurability: exdevRenameFallbackCount > 0,
  exdevRenameFallbackCount,
  lastExdevFallbackAt,
  lastExdevFallbackPath
});

export const getAtomicWriteDurabilityStatus = ({
  repoPath = null,
  cacheRoot = null,
  repoCacheRoot = null
} = {}) => {
  const repoDeviceId = readDeviceIdSync(repoPath);
  const cacheDeviceId = readDeviceIdSync(cacheRoot);
  const repoCacheDeviceId = readDeviceIdSync(repoCacheRoot);
  const deviceIds = [repoDeviceId, cacheDeviceId, repoCacheDeviceId].filter((value) => value != null);
  const uniqueDeviceIds = Array.from(new Set(deviceIds));
  const crossDeviceRisk = uniqueDeviceIds.length > 1;
  return {
    runtime: getAtomicWriteRuntimeMetrics(),
    layout: {
      repoPath: repoPath ? path.resolve(repoPath) : null,
      cacheRoot: cacheRoot ? path.resolve(cacheRoot) : null,
      repoCacheRoot: repoCacheRoot ? path.resolve(repoCacheRoot) : null,
      deviceIds: {
        repo: repoDeviceId,
        cache: cacheDeviceId,
        repoCache: repoCacheDeviceId
      },
      crossDeviceRisk,
      reason: crossDeviceRisk ? 'device_mismatch' : 'shared_device'
    }
  };
};

export const resetAtomicWriteRuntimeMetricsForTests = () => {
  exdevRenameFallbackCount = 0;
  lastExdevFallbackAt = null;
  lastExdevFallbackPath = null;
};
