import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { closeRuntimeResources } from './close-resources.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireFileLock } from '../../../shared/locks/file-lock.js';
import { createLockReleaseHandle } from '../../lock-release.js';
import { reopenSemanticDiskAccount } from '../../build/incremental/working-set.js';
import { createSemanticDiskAccount } from '../../build/artifacts/writers/semantic/partition.js';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { throwIfAborted, raceAbort } from '../../../shared/abort.js';
import { withRuntimeDestinationAccount } from './destination-writer-context.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { retainPublishedFileLockPrerequisite } from '../../../shared/locks/file-lock-producer-observations.js';

const charges = new WeakMap(), queues = new WeakMap(), accountingOwners = new WeakMap();
const receiptName = '.storage-budget.json';
const inventory = async (destination, signal) => reopenSemanticDiskAccount({ roots: [destination], limit: Number.MAX_SAFE_INTEGER, signal });
/** Preserve inventory identity when instrumentation wraps an existing account. */
export const wrapRuntimeDiskAccount = (owner, overrides) => {
  const wrapper = { reserve: overrides.reserve || (bytes => owner.reserve(bytes)),
    release: overrides.release || (bytes => owner.release(bytes)), get used() { return owner.used; }, limit: owner.limit };
  accountingOwners.set(wrapper, accountingOwners.get(owner) || owner);
  return wrapper;
};

/** Claims consume the same destination cap last explicitly admitted by import. */
export const readRuntimeDestinationBudget = async (destination, signal = null) => {
  const root = await fs.realpath(destination);
  const { buffer } = await readVerifiedContainedFile(root, path.join(root, receiptName), { maxBytes: 1024, signal });
  const value = JSON.parse(buffer.toString('utf8'));
  if (value.schemaVersion !== 1 || Object.keys(value).length !== 2
    || !Number.isSafeInteger(value.maxDiskWorkingSetBytes) || value.maxDiskWorkingSetBytes < 0) throw new TypeError('Invalid runtime destination budget receipt.');
  return value.maxDiskWorkingSetBytes;
};

/** Serialize accounting and mutations; pinned immutable readers need no writer lock. */
export const withRuntimeDestinationWriter = async ({ destination, maxDiskWorkingSetBytes, diskAccount = null, signal = null,
  checkAdmission = null, remainingMs = null, work = null }, operation) => {
  if (maxDiskWorkingSetBytes != null && (!Number.isSafeInteger(maxDiskWorkingSetBytes) || maxDiskWorkingSetBytes < 0)) throw new TypeError('Runtime destination working-set allowance required.');
  if (diskAccount && (typeof diskAccount.reserve !== 'function' || typeof diskAccount.release !== 'function')) throw new TypeError('Shared runtime disk account required.');
  if (checkAdmission !== null && typeof checkAdmission !== 'function') throw new TypeError('Invalid runtime writer admission owner.');
  if (remainingMs !== null && typeof remainingMs !== 'function') throw new TypeError('Invalid runtime writer remaining allowance.');
  const check = () => { throwIfAborted(signal); checkAdmission?.(); };
  check();
  await fs.mkdir(destination, { recursive: true });
  check();
  const root = await fs.realpath(destination);
  check();
  const waitMs = remainingMs ? Math.min(15000, Math.max(0, remainingMs())) : 15000;
  const rawLock = await acquireFileLock({ lockPath: path.join(root, '.writer.lock'), waitMs,
    pollMs: 25, signal, metadata: { scope: 'runtime-destination', destination: root } });
  if (!rawLock) { check(); throw Object.assign(new Error('Runtime destination writer is busy.'), { code: 'ERR_RUNTIME_WRITER_BUSY' }); }
  const lock = createLockReleaseHandle({ lock: rawLock, releaseLabel: 'runtime-writer.release' });
  const observations = [];
  const remember = value => {
    const observation = observeStorageResource(value, { phase: 'runtime-destination-writer' });
    if (observation.hasResourceObservation) {
      observations.push(observation);
      // The original metadata owner also guards its own asynchronous release
      // and synchronous exit cleanup. A report cannot replace this observer.
      retainPublishedFileLockPrerequisite(rawLock, observation.retain());
    }
    return observation;
  };
  const releaseAfterFailure = async error => {
    remember(error);
    await closeRuntimeResources([{ close: () => lock.release() }], error, { hasOperationError: true });
  };
  let lockBytes;
  try { check(); lockBytes = (await fs.lstat(rawLock.lockPath)).size; check(); }
  catch (error) { await releaseAfterFailure(error); }
  if (maxDiskWorkingSetBytes == null) {
    try { maxDiskWorkingSetBytes = await readRuntimeDestinationBudget(root, signal); }
    catch (error) { await releaseAfterFailure(error); }
  }
  const shared = diskAccount || createSemanticDiskAccount(maxDiskWorkingSetBytes);
  const accountingOwner = accountingOwners.get(shared) || shared;
  const previous = queues.get(accountingOwner) || Promise.resolve();
  let unlock;
  const queued = new Promise(resolve => { unlock = resolve; });
  queues.set(accountingOwner, queued);
  try { await raceAbort(signal, previous); }
  catch (error) {
    // Do not unblock a later shared-account owner before the earlier one drains.
    previous.then(unlock, unlock);
    await releaseAfterFailure(error);
  }
  let charged = 0, admitted = false;
  let retainedBaseline = null;
  let ledger = charges.get(accountingOwner);
  if (!ledger) { ledger = new Map(); charges.set(accountingOwner, ledger); }
  const account = {
    reserve(bytes) {
      if (bytes > maxDiskWorkingSetBytes - charged) throw Object.assign(new Error('Runtime destination working set exhausted.'), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
      shared.reserve(bytes); charged += bytes;
      if (retainedBaseline !== null) work?.observeReservation(Math.max(0, charged - retainedBaseline));
    },
    release(bytes) { shared.release(bytes); charged -= bytes; },
    get used() { return charged; }, limit: maxDiskWorkingSetBytes
  };
  let operationFailed = false, operationError;
  try {
    check();
    for (const other of ledger.keys()) {
      if (other !== root && (root.startsWith(other + path.sep) || other.startsWith(root + path.sep))) {
        throw new TypeError('A shared runtime account cannot own overlapping destination scopes.');
      }
    }
    const retained = await inventory(root, signal);
    retainedBaseline = retained.retainedBytes - lockBytes;
    work?.add('fileWriteBytes', lockBytes);
    check();
    if (retained.retainedBytes > maxDiskWorkingSetBytes) throw Object.assign(new Error('Retained runtime destination exceeds its working-set allowance.'),
      { code: 'ERR_SEMANTIC_DISK_LIMIT', retainedBytes: retained.retainedBytes });
    const prior = ledger.get(root) || 0;
    charged = prior;
    if (retained.retainedBytes > prior) account.reserve(retained.retainedBytes - prior);
    else account.release(prior - retained.retainedBytes);
    work?.observeReservation(Math.max(0, charged - retainedBaseline));
    admitted = true;
    const receipt = Buffer.from(JSON.stringify({ schemaVersion: 1, maxDiskWorkingSetBytes }));
    const filename = path.join(root, receiptName);
    let oldBytes = 0;
    try { oldBytes = (await fs.lstat(filename)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const oldReceipt = await readVerifiedContainedFile(root, filename, { maxBytes: 1024, signal })
      .catch(error => { if (error.code === 'ENOENT') return { buffer: Buffer.alloc(0) }; throw error; });
    check();
    if (!oldReceipt.buffer.equals(receipt)) {
      account.reserve(receipt.length);
      await atomicWriteText(filename, receipt, { newline: false });
      work?.add('fileWriteBytes', receipt.length);
      account.release(oldBytes);
    }
    check();
    const result = await withRuntimeDestinationAccount(root, account, () => operation({ destination: root, account }));
    remember(result).requireSettled();
    return result;
  } catch (error) { operationFailed = true; operationError = error; remember(error); throw error; }
  finally {
    const cleanupErrors = [];
    let retainedBytes = null;
    try {
      if (admitted) {
        try {
          // Filesystem inventory cannot prove outstanding native writes have
          // drained. Keep every reservation until that original owner settles.
          for (const observation of observations) observation.requireSettled();
          const retained = (await inventory(root, null)).retainedBytes;
          if (retained > charged) account.reserve(retained - charged);
          retainedBytes = retained;
        } finally { ledger.set(root, charged); }
      }
    } catch (error) { remember(error); cleanupErrors.push(error); }
    try {
      await lock.release();
      // Delay all reconciliation refunds until confirmed metadata removal.
      // The same original observers can change during release inspection.
      if (admitted) account.release(retainedBytes === null ? lockBytes : charged - retainedBytes + lockBytes);
    } catch (error) { cleanupErrors.push(error); }
    finally {
      try { if (admitted) ledger.set(root, charged); }
      finally { unlock(); }
    }
    if (cleanupErrors.length) {
      let failure = operationFailed ? operationError : cleanupErrors.shift();
      for (const error of cleanupErrors) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
      throw failure;
    }
  }
};
