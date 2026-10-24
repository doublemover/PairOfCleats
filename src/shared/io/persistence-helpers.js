import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../abort.js';
import { createContainedFileResource, getContainedFileSession } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { syncParentDirectory, syncParentDirectorySync, assertDirectoryIdentity } from './directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from './file-identity.js';
export { syncParentDirectory, syncParentDirectorySync } from './directory-sync.js';

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

export const waitForPath = async (targetPath, { attempts = 3, baseDelayMs = 10, signal = null } = {}) => {
  const resolvedAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 3;
  const resolvedBaseDelay = Number.isFinite(baseDelayMs) ? Math.max(1, Math.floor(baseDelayMs)) : 10;
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    throwIfAborted(signal);
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

export const readPersistenceFailureCode = error => {
  const observation = observeStorageResource(error, { phase: 'persistence-classification' });
  observation.requireSettled(); let code;
  try { code = observation.primary.code; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return typeof code === 'string' ? code : '';
};
export const retainPersistenceFailure = (primary, secondary = [], fields = {}) => {
  const sessions = [...new Set([primary, ...secondary].map(getContainedFileSession).filter(Boolean))];
  const context = { ...fields, ...(sessions.length ? { containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions) } : {}) };
  let failure = addStorageFailureContext(primary, context, null, { forceAggregate: true,
    nonEnumerable: ['containedFileSession', 'containedFileSessions'] });
  for (const error of secondary) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
  for (const field of ['cacheOwnershipPending', 'cacheOwnershipReleased']) {
    const descriptor = Object.getOwnPropertyDescriptor(failure, field);
    if (descriptor) Object.defineProperty(failure, field, { ...descriptor, configurable: false,
      ...('value' in descriptor ? { writable: false } : {}) });
  }
  return failure;
};
const requireRenamePrerequisites = (observations, primary) => {
  try { for (const observation of observations) observation.requireSettled(); }
  catch (pending) { throw retainPersistenceFailure(primary, [...observations.map(observation => observation.retain()), pending]); }
};
const observeCopyIdentity = (observer, identity) => {
  if (!observer) return;
  const result = observer(identity);
  if (result && typeof result.then === 'function') throw Object.assign(
    new Error('Synchronous persistence observer returned unknown asynchronous work.'), { cacheOwnershipPending: true });
};
export const copyFileWithDurability = async (sourcePath, targetPath, { exclusive = false, onTargetIdentity = null,
  expectedSourceIdentity = null } = {}) => {
  const parentIdentity = await fs.stat(path.dirname(targetPath), { bigint: true }); assertDirectoryIdentity(parentIdentity);
  const sourceIdentity = persistenceFileIdentity(await fs.stat(sourcePath, { bigint: true }), { multipleLinks: true });
  if (expectedSourceIdentity) assertPersistenceFileIdentity(await fs.lstat(sourcePath, { bigint: true }), expectedSourceIdentity);
  if (await fs.copyFile(sourcePath, targetPath, exclusive ? fsSync.constants.COPYFILE_EXCL : 0) !== undefined) throw Object.assign(
    new Error('Original file copy did not confirm its standard void result.'), { cacheOwnershipPending: true });
  const handle = await fs.open(targetPath, 'r+');
  const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['sync'] });
  const identity = await owner.run(async descriptor => {
    const sealed = persistenceFileIdentity(await descriptor.stat({ bigint: true }));
    assertPersistenceFileIdentity(await fs.lstat(targetPath, { bigint: true }), sealed);
    observeCopyIdentity(onTargetIdentity, sealed);
    await descriptor.sync();
    assertPersistenceFileIdentity(await descriptor.stat({ bigint: true }), sealed);
    assertPersistenceFileIdentity(await fs.lstat(targetPath, { bigint: true }), sealed);
    assertPersistenceFileIdentity(await fs.stat(sourcePath, { bigint: true }), sourceIdentity, { multipleLinks: true });
    return sealed;
  });
  await syncParentDirectory(targetPath, { expectedParent: parentIdentity });
  return identity;
};

export const copyFileWithDurabilitySync = (sourcePath, targetPath, { exclusive = false, onTargetIdentity = null,
  expectedSourceIdentity = null } = {}) => {
  const parentIdentity = fsSync.statSync(path.dirname(targetPath), { bigint: true }); assertDirectoryIdentity(parentIdentity);
  const sourceIdentity = persistenceFileIdentity(fsSync.statSync(sourcePath, { bigint: true }), { multipleLinks: true });
  if (expectedSourceIdentity) assertPersistenceFileIdentity(fsSync.lstatSync(sourcePath, { bigint: true }), expectedSourceIdentity);
  if (fsSync.copyFileSync(sourcePath, targetPath, exclusive ? fsSync.constants.COPYFILE_EXCL : 0) !== undefined) throw Object.assign(
    new Error('Original file copy did not confirm its standard void result.'), { cacheOwnershipPending: true });
  const methods = { receiver: fsSync, read: fsSync.readSync, stat: fsSync.fstatSync, close: fsSync.closeSync, sync: fsSync.fsyncSync };
  const fd = fsSync.openSync(targetPath, 'r+');
  const owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['sync'] });
  const identity = owner.runSync(descriptor => {
    const sealed = persistenceFileIdentity(descriptor.stat({ bigint: true }));
    assertPersistenceFileIdentity(fsSync.lstatSync(targetPath, { bigint: true }), sealed);
    observeCopyIdentity(onTargetIdentity, sealed);
    descriptor.sync();
    assertPersistenceFileIdentity(descriptor.stat({ bigint: true }), sealed);
    assertPersistenceFileIdentity(fsSync.lstatSync(targetPath, { bigint: true }), sealed);
    assertPersistenceFileIdentity(fsSync.statSync(sourcePath, { bigint: true }), sourceIdentity, { multipleLinks: true });
    return sealed;
  });
  syncParentDirectorySync(targetPath, { expectedParent: parentIdentity });
  return identity;
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
  } catch (error) { observeStorageResource(error, { phase: 'persistence-backup-cleanup' }).requireSettled(); }
};

export const cleanupBackupIfNeededSync = ({ keepBackup, backupAvailable, bakPath }) => {
  if (keepBackup || !backupAvailable) return;
  try {
    fsSync.rmSync(bakPath, { force: true });
  } catch (error) { observeStorageResource(error, { phase: 'persistence-backup-cleanup-sync' }).requireSettled(); }
};

export const renameWithRetry = async (
  fromPath,
  toPath,
  {
    attempts = REPLACE_FILE_RENAME_RETRY_ATTEMPTS,
    baseDelayMs = REPLACE_FILE_RENAME_BASE_DELAY_MS,
    retryableCodes = RETRYABLE_FILE_RENAME_CODES,
    signal = null,
    beforeRename = null
  } = {}
) => {
  const resolvedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  const resolvedBaseDelay = Math.max(1, Math.floor(Number(baseDelayMs) || 1));
  let lastError = null;
  const observations = [];
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    throwIfAborted(signal);
    requireRenamePrerequisites(observations, lastError);
    try {
      observeCopyIdentity(beforeRename, null);
      if (await fs.rename(fromPath, toPath) !== undefined) throw Object.assign(
        new Error('Original rename did not confirm its standard void result.'), { cacheOwnershipPending: true });
      return;
    } catch (err) {
      lastError = err;
      if (observations.length === 128) throw retainPersistenceFailure(err, [Object.assign(
        new Error('Rename prerequisite observation history exceeded its bounded limit.'), { cacheOwnershipPending: true })]);
      observations.push(observeStorageResource(err, { phase: 'persistence-rename' }));
      requireRenamePrerequisites(observations, lastError);
      const code = readPersistenceFailureCode(err); requireRenamePrerequisites(observations, lastError);
      if (!retryableCodes.has(code) || attempt >= resolvedAttempts - 1) {
        throw retainPersistenceFailure(err, observations.map(observation => observation.retain()));
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
    retryableCodes = RETRYABLE_FILE_RENAME_CODES,
    beforeRename = null
  } = {}
) => {
  const resolvedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastError = null;
  const observations = [];
  for (let attempt = 0; attempt < resolvedAttempts; attempt += 1) {
    requireRenamePrerequisites(observations, lastError);
    try {
      observeCopyIdentity(beforeRename, null);
      if (fsSync.renameSync(fromPath, toPath) !== undefined) throw Object.assign(
        new Error('Original rename did not confirm its standard void result.'), { cacheOwnershipPending: true });
      return;
    } catch (err) {
      lastError = err;
      if (observations.length === 128) throw retainPersistenceFailure(err, [Object.assign(
        new Error('Rename prerequisite observation history exceeded its bounded limit.'), { cacheOwnershipPending: true })]);
      observations.push(observeStorageResource(err, { phase: 'persistence-rename-sync' }));
      requireRenamePrerequisites(observations, lastError);
      const code = readPersistenceFailureCode(err); requireRenamePrerequisites(observations, lastError);
      if (!retryableCodes.has(code) || attempt >= resolvedAttempts - 1) {
        throw retainPersistenceFailure(err, observations.map(observation => observation.retain()));
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
    } catch (error) { observeStorageResource(error, { phase: 'persistence-fallback-report' }).requireSettled(); }
  }
};
