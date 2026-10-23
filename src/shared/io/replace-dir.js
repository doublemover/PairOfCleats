import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  REPLACE_DIR_RENAME_ATTEMPTS,
  REPLACE_DIR_RENAME_BASE_DELAY_MS,
  RETRYABLE_DIR_RENAME_CODES,
  sleep,
  syncParentDirectory,
  createSiblingBackupPath,
  readPersistenceFailureCode
} from './persistence-helpers.js';
import { persistenceDirectoryIdentity, assertPersistenceDirectoryIdentity } from './directory-identity.js';
import { getContainedFileSession } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

const missingTemp = file => Object.assign(new Error('Temp dir missing before replace: ' + file), { code: 'ERR_TEMP_MISSING' });
const unconfirmed = message => Object.assign(new Error(message), { cacheOwnershipPending: true });
const readDirectory = async file => {
  try { return persistenceDirectoryIdentity(await fs.lstat(file, { bigint: true })); }
  catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') return null; throw error; }
};

/** Replace an admitted directory root, preserving its only recoverable backup.
 * Tree contents remain caller-owned; root comparisons do not seal every child.
 */
export const replaceDir = async (tempPath, finalPath, options = {}) => {
  tempPath = path.resolve(tempPath); finalPath = path.resolve(finalPath);
  const sourceIdentity = await readDirectory(tempPath);
  if (!sourceIdentity) throw missingTemp(tempPath);
  if (tempPath === finalPath) return { backupPath: null };
  for (const [parent, child] of [[tempPath, finalPath], [finalPath, tempPath]]) {
    const relative = path.relative(parent, child);
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Object.assign(
      new Error('Directory replacement source and destination must not overlap.'), { code: 'EINVAL' });
  }
  const initialIdentity = await readDirectory(finalPath), keepBackup = options.keepBackup === true;
  const targetParent = path.dirname(finalPath), sourceParent = path.dirname(tempPath);
  const parentIdentity = await fs.lstat(targetParent, { bigint: true }); persistenceDirectoryIdentity(parentIdentity);
  const sourceParentIdentity = persistenceDirectoryIdentity(await fs.lstat(sourceParent, { bigint: true }));
  const bakPath = createSiblingBackupPath(finalPath), recoveryPaths = new Set([tempPath]);
  const authorizedPaths = new Set([tempPath, bakPath]), observations = [], failures = [], cleanupErrors = [];
  let backupAvailable = false, stagedPath = null, stagedIdentity = null, stagedAvailable = false;
  let committed = false, copiedPromotion = false, promotionAttempted = false, operationPresent = false, operationError;
  let observationOverflow = false;
  const overflowFailure = unconfirmed('Directory replacement observation history exceeded its bounded limit.');
  const observe = (error, phase) => {
    if (observations.length === 128) { observationOverflow = true; return; }
    failures.push(error); observations.push(observeStorageResource(error, { phase }));
  };
  const requireSettled = () => {
    if (observationOverflow) throw overflowFailure;
    for (const observation of observations) observation.requireSettled();
  };
  const checkParent = file => {
    const parent = path.dirname(file);
    if (parent !== targetParent && parent !== sourceParent) throw new Error('Directory replacement escaped its admitted parents.');
    assertPersistenceDirectoryIdentity(fsSync.lstatSync(parent, { bigint: true }),
      parent === targetParent ? persistenceDirectoryIdentity(parentIdentity) : sourceParentIdentity);
  };
  const checkRoot = (file, identity) => {
    requireSettled(); checkParent(file);
    assertPersistenceDirectoryIdentity(fsSync.lstatSync(file, { bigint: true }), identity); requireSettled();
  };
  const requireAbsent = file => {
    requireSettled(); checkParent(file);
    try { fsSync.lstatSync(file, { bigint: true }); }
    catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') { requireSettled(); return; } throw error; }
    throw Object.assign(new Error('Directory replacement destination is occupied; original evidence is retained.'), { code: 'EEXIST' });
  };
  const move = async (from, to, identity, afterRename = null) => {
    for (let attempt = 0; attempt < REPLACE_DIR_RENAME_ATTEMPTS; attempt += 1) {
      requireSettled(); checkRoot(from, identity); requireAbsent(to);
      try {
        if (await fs.rename(from, to) !== undefined) throw unconfirmed('Directory rename did not confirm its standard void result.');
        // Record the successful native transition before any verification can fail.
        afterRename?.(); checkRoot(to, identity); return;
      } catch (error) {
        observe(error, 'directory-replacement-rename'); requireSettled();
        const code = readPersistenceFailureCode(error); requireSettled();
        if (!RETRYABLE_DIR_RENAME_CODES.has(code) || attempt === REPLACE_DIR_RENAME_ATTEMPTS - 1) throw error;
        await sleep(REPLACE_DIR_RENAME_BASE_DELAY_MS * (attempt + 1));
      }
    }
  };
  const removeOwned = async (file, identity) => {
    requireSettled();
    if (!authorizedPaths.has(file)) throw new Error('Directory cleanup requires an admitted original path.');
    checkParent(file); let current;
    try { current = await fs.lstat(file, { bigint: true }); }
    catch (error) { if (readPersistenceFailureCode(error) === 'ENOENT') { requireSettled(); recoveryPaths.delete(file); return; } throw error; }
    requireSettled(); checkParent(file); assertPersistenceDirectoryIdentity(current, identity); requireSettled();
    if (await fs.rm(file, { recursive: true, force: true }) !== undefined) throw unconfirmed('Directory cleanup did not confirm its standard void result.');
    requireSettled(); recoveryPaths.delete(file);
  };
  const cleanup = async (file, identity) => {
    try { await removeOwned(file, identity); }
    catch (error) { observe(error, 'directory-replacement-cleanup'); cleanupErrors.push(error); recoveryPaths.add(file); }
  };
  const restoreBackup = async () => {
    if (!backupAvailable) return;
    try {
      requireSettled();
      const current = await readDirectory(finalPath); requireSettled();
      if (current) {
        // Only an exact admitted new root may be moved aside. A foreign or
        // replaced current directory must never be removed to restore backup.
        const candidate = [
          [tempPath, sourceIdentity], [stagedPath, stagedIdentity]
        ].find(([file, identity]) => file && identity && Object.keys(identity).every(key => identity[key] === current[key]));
        if (!candidate) throw new Error('Current directory is not the admitted promotion; backup recovery remains explicit.');
        await move(finalPath, candidate[0], candidate[1], () => { if (candidate[0] === stagedPath) stagedAvailable = true; });
      }
      await move(bakPath, finalPath, initialIdentity, () => { backupAvailable = false; recoveryPaths.delete(bakPath); });
    } catch (error) { observe(error, 'directory-replacement-restore'); cleanupErrors.push(error); recoveryPaths.add(bakPath); }
  };
  const copyFallback = async () => {
    stagedPath = createSiblingBackupPath(finalPath) + '.staged'; authorizedPaths.add(stagedPath); recoveryPaths.add(stagedPath);
    requireSettled(); checkRoot(tempPath, sourceIdentity); requireAbsent(finalPath); requireAbsent(stagedPath);
    if (await fs.mkdir(stagedPath) !== undefined) throw unconfirmed('Staging directory creation did not confirm its standard void result.');
    // This successful exclusive creation owns only this exact root, never an
    // existing or subsequently replaced pathname discovered after copy failure.
    stagedIdentity = await readDirectory(stagedPath); stagedAvailable = true; requireSettled();
    if (!stagedIdentity) throw new Error('Created staging directory disappeared before its identity was sealed.');
    if (await fs.cp(tempPath, stagedPath, { recursive: true, force: false, errorOnExist: true }) !== undefined) throw unconfirmed(
      'Directory copy did not confirm its standard void result.');
    requireSettled(); checkRoot(tempPath, sourceIdentity); checkRoot(stagedPath, stagedIdentity);
    await move(stagedPath, finalPath, stagedIdentity, () => {
      committed = true; copiedPromotion = true; stagedAvailable = false; recoveryPaths.delete(stagedPath);
    });
  };
  try {
    await options.onBeforePromote?.({ backupPath: initialIdentity ? bakPath : null });
    requireSettled(); checkRoot(tempPath, sourceIdentity);
    if (initialIdentity) {
      recoveryPaths.add(bakPath);
      await move(finalPath, bakPath, initialIdentity, () => { backupAvailable = true; });
    } else requireAbsent(finalPath);
    promotionAttempted = true;
    try {
      await move(tempPath, finalPath, sourceIdentity, () => { committed = true; recoveryPaths.delete(tempPath); });
    } catch (error) {
      // Never retry or allocate fallback after a successful native commit whose
      // verification/durability failed, or while original work remains unknown.
      requireSettled(); if (committed || !RETRYABLE_DIR_RENAME_CODES.has(readPersistenceFailureCode(error))) throw error;
      requireSettled();
      try { await move(tempPath, finalPath, sourceIdentity, () => { committed = true; recoveryPaths.delete(tempPath); }); }
      catch (repeatError) {
        requireSettled(); if (committed || options.allowCopyFallback === false) throw repeatError;
        try { await copyFallback(); }
        catch (copyError) { observe(copyError, 'directory-replacement-copy'); throw committed ? copyError : repeatError; }
      }
    }
    requireSettled(); await syncParentDirectory(finalPath, { expectedParent: parentIdentity }); requireSettled();
    if (copiedPromotion) await removeOwned(tempPath, sourceIdentity);
    if (!keepBackup && backupAvailable) {
      await removeOwned(bakPath, initialIdentity); backupAvailable = false;
    }
  } catch (error) {
    operationPresent = true; operationError = error; observe(error, 'directory-replacement');
    if (!committed) await restoreBackup();
  } finally {
    if (!committed && stagedAvailable && stagedIdentity) await cleanup(stagedPath, stagedIdentity);
  }
  if (operationPresent || cleanupErrors.length) {
    const primary = operationPresent ? operationError : cleanupErrors[0];
    const independent = [...new Set([...failures, ...(observationOverflow ? [overflowFailure] : [])])].filter(error => error !== primary);
    const sessions = [...new Set([primary, ...independent].map(getContainedFileSession).filter(Boolean))];
    // Freeze the original observations before attaching to a mutable primary.
    const originals = Object.freeze([...observations]);
    let failure = addStorageFailureContext(primary, {
      recoveryPaths: Object.freeze([...recoveryPaths]), cleanupErrors: Object.freeze([...cleanupErrors]),
      directoryReplacementState: committed ? 'committed' : promotionAttempted ? 'promotion-unconfirmed' : 'uncommitted',
      cacheOwnershipPending: true, cacheOwnershipReleased: () => !observationOverflow && originals.every(observation => observation.isSettled()),
      ...(sessions.length ? { containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions) } : {})
    }, null, { nonEnumerable: ['containedFileSession', 'containedFileSessions'] });
    for (const secondary of independent) failure = addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true });
    for (const field of ['cacheOwnershipPending', 'cacheOwnershipReleased']) {
      const descriptor = Object.getOwnPropertyDescriptor(failure, field);
      if (descriptor) Object.defineProperty(failure, field, { ...descriptor, configurable: false,
        ...('value' in descriptor ? { writable: false } : {}) });
    }
    throw failure;
  }
  return { backupPath: keepBackup && backupAvailable ? bakPath : null };
};
