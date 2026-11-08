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
  readPersistenceFailureCode,
  retainPersistenceFailure,
  waitForPath
} from './persistence-helpers.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from './file-identity.js';
import { observeStorageResource } from '../storage/failure-observation.js';

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
    if (readPersistenceFailureCode(error) === 'ENOENT') return null;
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

const requireSynchronous = (callback, receiver) => {
  const result = callback?.call(receiver);
  if (result && typeof result.then === 'function') throw Object.assign(
    new Error('Synchronous replacement prerequisite returned unknown asynchronous work.'), { cacheOwnershipPending: true });
};
const removeKnownPath = async (file, identity, requireSettled) => {
  requireSettled(); let current;
  try { current = await fs.lstat(file, { bigint: true }); }
  catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') { requireSettled(); return; } throw error; }
  requireSettled(); assertPersistenceFileIdentity(current, identity); requireSettled();
  if (await fs.rm(file, { force: true }) !== undefined) throw Object.assign(
    new Error('Replacement cleanup did not confirm its standard void result.'), { cacheOwnershipPending: true });
  requireSettled();
};
const removeKnownPathSync = (file, identity, requireSettled) => {
  requireSettled(); let current;
  try { current = fsSync.lstatSync(file, { bigint: true }); }
  catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') { requireSettled(); return; } throw error; }
  requireSettled(); assertPersistenceFileIdentity(current, identity); requireSettled();
  if (fsSync.rmSync(file, { force: true }) !== undefined) throw Object.assign(
    new Error('Replacement cleanup did not confirm its standard void result.'), { cacheOwnershipPending: true });
  requireSettled();
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
  const sourceIdentity = persistenceFileIdentity(sourceStat), prerequisite = options.requireSettled;
  const initialIdentity = initialStat?.isFile() ? persistenceFileIdentity(initialStat, { multipleLinks: true }) : null;
  let backupPath = null, stagedPath = null, backupIdentity = null, stagedIdentity = null, committed = false, stagedCommitted = false;
  let operationPresent = false, operationError, publicationAttempted = false;
  const observations = [], cleanupErrors = [], retainedPaths = [];
  const requireSettled = () => {
    for (const observation of observations) observation.requireSettled();
    requireSynchronous(prerequisite, options);
  };
  const beforeSourceRename = () => {
    requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(tempPath, { bigint: true }), sourceIdentity); requireSettled();
  };
  const requireUncommittedBackup = () => {
    requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(tempPath, { bigint: true }), sourceIdentity);
    const current = readFinalStat(finalPath);
    if (initialStat) {
      if (!initialIdentity || !current) throw new Error('Unconfirmed replacement preserves its original backup evidence.');
      assertPersistenceFileIdentity(current, initialIdentity, { multipleLinks: true });
    } else if (current) throw new Error('Concurrent target publication preserves replacement backup evidence.');
    requireSettled();
  };
  try {
    requireSettled();
    if (initialStat && options.keepBackup === true) {
      backupPath = createSiblingBackupPath(finalPath);
      await copyFileWithDurability(finalPath, backupPath, { exclusive: true, onTargetIdentity: identity => { backupIdentity = identity; } });
    }
    try {
      publicationAttempted = true;
      await renameWithRetry(tempPath, finalPath, { signal: options.signal, beforeRename: beforeSourceRename });
    } catch (error) {
      const original = observeStorageResource(error, { phase: 'replace-file-rename' }); observations.push(original);
      requireSettled(); const code = readPersistenceFailureCode(error); requireSettled();
      if (code === 'ENOENT' && concurrentCommitSucceeded(tempPath, finalPath, sourceStat)) {
        requireSettled();
        committed = true;
        return;
      }
      if (code !== 'EXDEV') throw error;
      stagedPath = `${createSiblingBackupPath(finalPath)}.tmp`;
      requireSettled();
      await copyFileWithDurability(tempPath, stagedPath, { exclusive: true, expectedSourceIdentity: sourceIdentity,
        onTargetIdentity: identity => { stagedIdentity = identity; } });
      await renameWithRetry(stagedPath, finalPath, { signal: options.signal, beforeRename: () => {
        requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(stagedPath, { bigint: true }), stagedIdentity); requireSettled();
      } });
      committed = true; stagedCommitted = true;
      await removeKnownPath(tempPath, sourceIdentity, requireSettled);
      maybeReportExdevFallback(options, code);
    }
    committed = true;
  } catch (error) {
    operationPresent = true; operationError = error;
    observations.push(observeStorageResource(error, { phase: 'replace-file' }));
  } finally {
    for (const [file, identity] of [[stagedCommitted ? null : stagedPath, stagedIdentity], [committed ? null : backupPath, backupIdentity]]) {
      if (!file) continue;
      if (!identity) { retainedPaths.push(file); continue; }
      try {
        if (file === backupPath) requireUncommittedBackup();
        await removeKnownPath(file, identity, requireSettled);
      }
      catch (error) {
        const captured = observeStorageResource(error, { phase: 'replace-file-cleanup' }); observations.push(captured);
        cleanupErrors.push(captured.retain()); retainedPaths.push(file);
      }
    }
    if (operationPresent || cleanupErrors.length) {
      const primary = operationPresent ? operationError : cleanupErrors.shift();
      throw retainPersistenceFailure(primary, [...observations.map(observation => observation.retain()), ...cleanupErrors], {
        replacementState: committed ? 'committed' : publicationAttempted ? 'commit-unconfirmed' : 'uncommitted',
        replacementRetainedPaths: Object.freeze(retainedPaths)
      });
    }
  }
};

export const replaceFileSync = (tempPath, finalPath, options = {}) => {
  if (samePathAlreadyCommitted(tempPath, finalPath)) return;
  const initialStat = readFinalStat(finalPath);
  if (!fsSync.existsSync(tempPath)) {
    throw createTempMissingError(tempPath);
  }
  const sourceStat = fsSync.lstatSync(tempPath, { bigint: true });
  const sourceIdentity = persistenceFileIdentity(sourceStat), prerequisite = options.requireSettled;
  const initialIdentity = initialStat?.isFile() ? persistenceFileIdentity(initialStat, { multipleLinks: true }) : null;
  let backupPath = null, stagedPath = null, backupIdentity = null, stagedIdentity = null, committed = false, stagedCommitted = false;
  let operationPresent = false, operationError, publicationAttempted = false;
  const observations = [], cleanupErrors = [], retainedPaths = [];
  const requireSettled = () => {
    for (const observation of observations) observation.requireSettled();
    requireSynchronous(prerequisite, options);
  };
  const beforeSourceRename = () => {
    requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(tempPath, { bigint: true }), sourceIdentity); requireSettled();
  };
  const requireUncommittedBackup = () => {
    requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(tempPath, { bigint: true }), sourceIdentity);
    const current = readFinalStat(finalPath);
    if (initialStat) {
      if (!initialIdentity || !current) throw new Error('Unconfirmed replacement preserves its original backup evidence.');
      assertPersistenceFileIdentity(current, initialIdentity, { multipleLinks: true });
    } else if (current) throw new Error('Concurrent target publication preserves replacement backup evidence.');
    requireSettled();
  };
  try {
    requireSettled();
    if (initialStat && options.keepBackup === true) {
      backupPath = createSiblingBackupPath(finalPath);
      copyFileWithDurabilitySync(finalPath, backupPath, { exclusive: true, onTargetIdentity: identity => { backupIdentity = identity; } });
    }
    try {
      publicationAttempted = true;
      renameWithRetrySync(tempPath, finalPath, { beforeRename: beforeSourceRename });
    } catch (error) {
      observations.push(observeStorageResource(error, { phase: 'replace-file-rename-sync' }));
      requireSettled(); const code = readPersistenceFailureCode(error); requireSettled();
      if (code === 'ENOENT' && concurrentCommitSucceeded(tempPath, finalPath, sourceStat)) {
        requireSettled();
        committed = true;
        return;
      }
      if (code !== 'EXDEV') throw error;
      stagedPath = `${createSiblingBackupPath(finalPath)}.tmp`;
      requireSettled();
      copyFileWithDurabilitySync(tempPath, stagedPath, { exclusive: true, expectedSourceIdentity: sourceIdentity,
        onTargetIdentity: identity => { stagedIdentity = identity; } });
      renameWithRetrySync(stagedPath, finalPath, { beforeRename: () => {
        requireSettled(); assertPersistenceFileIdentity(fsSync.lstatSync(stagedPath, { bigint: true }), stagedIdentity); requireSettled();
      } });
      committed = true; stagedCommitted = true;
      removeKnownPathSync(tempPath, sourceIdentity, requireSettled);
      maybeReportExdevFallback(options, code);
    }
    committed = true;
  } catch (error) {
    operationPresent = true; operationError = error;
    observations.push(observeStorageResource(error, { phase: 'replace-file-sync' }));
  } finally {
    for (const [file, identity] of [[stagedCommitted ? null : stagedPath, stagedIdentity], [committed ? null : backupPath, backupIdentity]]) {
      if (!file) continue;
      if (!identity) { retainedPaths.push(file); continue; }
      try {
        if (file === backupPath) requireUncommittedBackup();
        removeKnownPathSync(file, identity, requireSettled);
      }
      catch (error) {
        const captured = observeStorageResource(error, { phase: 'replace-file-cleanup-sync' }); observations.push(captured);
        cleanupErrors.push(captured.retain()); retainedPaths.push(file);
      }
    }
    if (operationPresent || cleanupErrors.length) {
      const primary = operationPresent ? operationError : cleanupErrors.shift();
      throw retainPersistenceFailure(primary, [...observations.map(observation => observation.retain()), ...cleanupErrors], {
        replacementState: committed ? 'committed' : publicationAttempted ? 'commit-unconfirmed' : 'uncommitted',
        replacementRetainedPaths: Object.freeze(retainedPaths)
      });
    }
  }
};
