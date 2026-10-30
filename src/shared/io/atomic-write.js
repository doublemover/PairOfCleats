import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempPath } from './temp-path.js';
import { replaceFile, replaceFileSync } from './replace-file.js';
import { joinPathSafe, normalizePathForPlatform } from '../path-normalize.js';
import { incAtomicPersistenceFallback } from '../metrics/core.js';
import { throwIfAborted } from '../abort.js';
import { createContainedFileResource, getContainedFileSession } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { assertDirectoryIdentity as assertAtomicDirectory, syncParentDirectory, syncParentDirectorySync } from './directory-sync.js';

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

const createAtomicWriteError = (operation, targetPath, err, fields = {}, secondary = [], sourceObservation = null) => {
  const observation = sourceObservation || observeStorageResource(err, { phase: 'atomic-write' });
  let message = 'Unknown atomic persistence failure.', code = '', name = '', inspection, inspectionPresent = false;
  try {
    const originalMessage = observation.primary.message, originalCode = observation.primary.code, originalName = observation.primary.name;
    if (typeof originalMessage === 'string') message = originalMessage;
    if (typeof originalCode === 'string') code = originalCode;
    if (typeof originalName === 'string') name = originalName;
  } catch (value) { inspection = value; inspectionPresent = true; }
  const original = inspectionPresent ? observation.retain(inspection, { inspectionPresent: true }) : observation.retain();
  const sessions = [...new Set([err, ...secondary, ...(inspectionPresent ? [inspection] : [])].map(getContainedFileSession).filter(Boolean))];
  const context = { ...fields, ...(sessions.length ? { containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions) } : {}) };
  const options = { secondaryPresent: true, nonEnumerable: ['containedFileSession', 'containedFileSessions'] };
  if (name === 'AbortError' || code === 'ABORT_ERR') {
    let failure = addStorageFailureContext(err, context, original, options);
    for (const error of secondary) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
    return failure;
  }
  const wrapped = new Error(`[atomic-write] Failed to ${operation} "${targetPath}": ${message}`, { cause: err });
  wrapped.code = 'ERR_ATOMIC_WRITE';
  wrapped.operation = operation;
  wrapped.path = targetPath;
  wrapped.causeCode = code || null;
  let failure = addStorageFailureContext(wrapped, context, original, options);
  for (const error of secondary) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
  Object.defineProperty(failure, 'cause', { value: err, writable: true, configurable: true });
  return failure;
};

const atomicIdentity = stat => {
  if (!stat.isFile() || stat.ino === 0n || stat.nlink < 1n || stat.nlink > 2n) throw new Error('Atomic staging requires an exact ordinary file identity.');
  return Object.freeze({ dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size,
    mtime: String(stat.mtimeNs ?? stat.mtimeMs), birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};
const assertAtomicIdentity = (stat, expected) => {
  const actual = atomicIdentity(stat);
  if (!expected || Object.keys(expected).some(key => expected[key] !== actual[key])) throw Object.assign(
    new Error('Atomic staging or rollback pathname no longer identifies its sealed original file.'), { code: 'ERR_ATOMIC_FILE_CHANGED' });
};
const failureCode = error => {
  const observation = observeStorageResource(error, { phase: 'atomic-write-classification' });
  observation.requireSettled(); let code;
  try { code = observation.primary.code; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return code;
};
const removeOwnedAtomicPath = async (file, identity, requireSettled = () => {}) => {
  requireSettled();
  let stat;
  try { stat = await fs.lstat(file, { bigint: true }); }
  catch (error) { if (failureCode(error) === 'ENOENT') { requireSettled(); return; } throw error; }
  requireSettled();
  assertAtomicIdentity(stat, identity);
  if (await fs.unlink(file) !== undefined) throw Object.assign(new Error('Atomic owned-file unlink did not confirm its standard void result.'), { cacheOwnershipPending: true });
  requireSettled();
};
const removeOwnedAtomicPathSync = (file, identity, requireSettled = () => {}) => {
  requireSettled();
  let stat;
  try { stat = fsSync.lstatSync(file, { bigint: true }); }
  catch (error) { if (failureCode(error) === 'ENOENT') { requireSettled(); return; } throw error; }
  requireSettled();
  assertAtomicIdentity(stat, identity);
  if (fsSync.unlinkSync(file) !== undefined) throw Object.assign(new Error('Atomic owned-file unlink did not confirm its standard void result.'), { cacheOwnershipPending: true });
  requireSettled();
};
const syncResourceMethods = () => ({ receiver: fsSync, read: fsSync.readSync, stat: fsSync.fstatSync,
  close: fsSync.closeSync, writeFile: fsSync.writeFileSync, sync: fsSync.fsyncSync });

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
      if (!OPEN_RETRY_CODES.has(failureCode(err)) || attempts >= OPEN_RETRY_ATTEMPTS) {
        throw err;
      }
      const delayMs = Math.min(250, OPEN_RETRY_BASE_DELAY_MS * (2 ** (attempts - 1)));
      await sleep(delayMs);
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
  const tempPath = createTempPath(safeTargetPath, { sameDirectory: true });
  if (mkdir && tempPath && path.dirname(tempPath) !== parent) {
    // Long-path staging can select a different directory. The ordinary same-
    // parent case was already created above and is admitted by stat below.
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
  }
  let owner = null, identity = null, published = false, committed = false, cleanupAttempted = false, publicationAttempted = false;
  try {
    const parentIdentity = await fs.stat(parent, { bigint: true }); assertAtomicDirectory(parentIdentity);
    const handle = await openWithRetry(tempPath, 'wx', mode);
    owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['writeFile', 'write', 'sync'] });
    const requireOwner = () => {
      if (!owner.isSettled()) throw Object.assign(new Error('Atomic descriptor original work remains unconfirmed before publication cleanup.'),
        { cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled });
    };
    await owner.run(async descriptor => {
      const initial = await descriptor.stat({ bigint: true }); identity = atomicIdentity(initial);
      if (initial.nlink !== 1n) throw new Error('Atomic staging admission requires its exclusive single-link file.');
      await verifyStaging?.(handle, tempPath);
      throwIfAborted(signal);
      if (writePayload) await writePayload(descriptor);
      else if (Buffer.isBuffer(payload)) await descriptor.writeFile(payload);
      else await descriptor.writeFile(String(payload), { encoding });
      identity = atomicIdentity(await descriptor.stat({ bigint: true }));
      await descriptor.sync();
      await beforeCommit?.(handle, tempPath);
      throwIfAborted(signal);
      identity = atomicIdentity(await descriptor.stat({ bigint: true }));
      if (createOnly) {
        // Same-directory hard-link publication is atomic and fails if the name
        // already exists. Never fall back to overwriting rename or copy.
        publicationAttempted = true;
        if (await fs.link(tempPath, safeTargetPath) !== undefined) throw Object.assign(
          new Error('Atomic create-only link did not confirm its standard void result.'), { cacheOwnershipPending: true });
        published = true;
        await verifyPublished?.(handle, safeTargetPath);
      }
    });
    if (createOnly) {
      committed = true;
      cleanupAttempted = true;
      await removeOwnedAtomicPath(tempPath, identity, requireOwner);
    } else {
      assertAtomicIdentity(await fs.lstat(tempPath, { bigint: true }), identity);
      requireOwner();
      publicationAttempted = true;
      await replaceFile(tempPath, safeTargetPath, {
        keepBackup: false,
        signal,
        requireSettled: requireOwner,
        onExdevFallback: () => {
          recordExdevFallback(safeTargetPath);
        }
      });
      committed = true;
    }
    await syncParentDirectory(safeTargetPath, { expectedParent: parentIdentity, unsupportedCodes: DIR_SYNC_UNSUPPORTED_CODES });
    return safeTargetPath;
  } catch (err) {
    const observation = observeStorageResource(err, { phase: 'atomic-write-rollback' });
    const secondary = [];
    const requireRollback = () => {
      observation.requireSettled();
      for (const error of secondary) observeStorageResource(error, { phase: 'atomic-write-rollback-cleanup' }).requireSettled();
      if (owner && !owner.isSettled()) throw Object.assign(new Error('Atomic descriptor original work remains pending during rollback.'),
        { cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled });
    };
    let settled = false;
    try { observation.requireSettled(); settled = !owner || owner.isSettled(); }
    catch (pending) { secondary.push(pending); }
    if (settled && !committed && identity) {
      if (published) {
        try { await removeOwnedAtomicPath(safeTargetPath, identity, requireRollback); }
        catch (cleanupError) { secondary.push(observeStorageResource(cleanupError, { phase: 'atomic-write-target-cleanup' }).retain()); }
      }
      // A cleanup failure can itself own native work. Never proceed to another
      // destructive operation until each captured original prerequisite settles.
      try {
        for (const error of secondary) observeStorageResource(error, { phase: 'atomic-write-rollback-cleanup' }).requireSettled();
        observation.requireSettled();
        if (!cleanupAttempted) {
          cleanupAttempted = true;
          await removeOwnedAtomicPath(tempPath, identity, requireRollback);
        }
      } catch (cleanupError) { secondary.push(observeStorageResource(cleanupError, { phase: 'atomic-write-staging-cleanup' }).retain()); }
    }
    throw createAtomicWriteError('write file atomically', safeTargetPath, err, {
      atomicWriteStagingPath: tempPath, atomicWritePublicationState: committed ? 'committed' : published ? 'linked-unconfirmed'
        : publicationAttempted ? createOnly ? 'create-unconfirmed' : 'replace-unconfirmed' : 'uncommitted'
    }, secondary, observation);
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
  const tempPath = createTempPath(safeTargetPath, { sameDirectory: true });
  if (mkdir && tempPath && path.dirname(tempPath) !== parent) {
    fsSync.mkdirSync(path.dirname(tempPath), { recursive: true });
  }
  let owner = null, identity = null, committed = false, publicationAttempted = false;
  try {
    const parentIdentity = fsSync.statSync(parent, { bigint: true }); assertAtomicDirectory(parentIdentity);
    const methods = syncResourceMethods();
    const fd = mode == null
      ? fsSync.openSync(tempPath, 'wx')
      : fsSync.openSync(tempPath, 'wx', mode);
    owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['writeFile', 'sync'] });
    const requireOwner = () => {
      if (!owner.isSettled()) throw Object.assign(new Error('Atomic sync descriptor original work remains unconfirmed before publication.'),
        { cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled });
    };
    owner.runSync(descriptor => {
      const initial = descriptor.stat({ bigint: true }); identity = atomicIdentity(initial);
      if (initial.nlink !== 1n) throw new Error('Atomic staging admission requires its exclusive single-link file.');
      if (Buffer.isBuffer(payload)) descriptor.writeFile(payload);
      else descriptor.writeFile(String(payload), { encoding });
      identity = atomicIdentity(descriptor.stat({ bigint: true }));
      if (durable !== false) descriptor.sync();
    });
    assertAtomicIdentity(fsSync.lstatSync(tempPath, { bigint: true }), identity);
    publicationAttempted = true;
    replaceFileSync(tempPath, safeTargetPath, {
      keepBackup: false,
      requireSettled: requireOwner,
      onExdevFallback: () => {
        recordExdevFallback(safeTargetPath);
      }
    });
    committed = true;
    if (durable !== false) {
      syncParentDirectorySync(safeTargetPath, { expectedParent: parentIdentity, unsupportedCodes: DIR_SYNC_UNSUPPORTED_CODES });
    }
    return safeTargetPath;
  } catch (err) {
    const observation = observeStorageResource(err, { phase: 'atomic-write-rollback-sync' });
    const secondary = [];
    try {
      observation.requireSettled();
      const requireRollback = () => {
        observation.requireSettled();
        if (owner && !owner.isSettled()) throw Object.assign(new Error('Atomic sync descriptor original work remains pending during rollback.'),
          { cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled });
      };
      if (!committed && identity && (!owner || owner.isSettled())) removeOwnedAtomicPathSync(tempPath, identity, requireRollback);
    } catch (cleanupError) { secondary.push(cleanupError); }
    throw createAtomicWriteError('write file atomically', safeTargetPath, err, {
      atomicWriteStagingPath: tempPath, atomicWritePublicationState: committed ? 'committed'
        : publicationAttempted ? 'replace-unconfirmed' : 'uncommitted'
    }, secondary, observation);
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
