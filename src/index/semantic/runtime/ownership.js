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
export const withRuntimeDestinationWriter = async ({ destination, maxDiskWorkingSetBytes, diskAccount = null, signal = null }, operation) => {
  if (maxDiskWorkingSetBytes != null && (!Number.isSafeInteger(maxDiskWorkingSetBytes) || maxDiskWorkingSetBytes < 0)) throw new TypeError('Runtime destination working-set allowance required.');
  if (diskAccount && (typeof diskAccount.reserve !== 'function' || typeof diskAccount.release !== 'function')) throw new TypeError('Shared runtime disk account required.');
  throwIfAborted(signal);
  await fs.mkdir(destination, { recursive: true });
  const root = await fs.realpath(destination);
  const rawLock = await acquireFileLock({ lockPath: path.join(root, '.writer.lock'), waitMs: 15000,
    pollMs: 25, signal, metadata: { scope: 'runtime-destination', destination: root } });
  if (!rawLock) throw Object.assign(new Error('Runtime destination writer is busy.'), { code: 'ERR_RUNTIME_WRITER_BUSY' });
  const lock = createLockReleaseHandle({ lock: rawLock, releaseLabel: 'runtime-writer.release' });
  let lockBytes;
  try { lockBytes = (await fs.lstat(rawLock.lockPath)).size; }
  catch (error) { await closeRuntimeResources([{ close: () => lock.release() }], error, { hasOperationError: true }); }
  if (maxDiskWorkingSetBytes == null) {
    try { maxDiskWorkingSetBytes = await readRuntimeDestinationBudget(root, signal); }
    catch (error) { await closeRuntimeResources([{ close: () => lock.release() }], error, { hasOperationError: true }); }
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
    await closeRuntimeResources([{ close: () => lock.release() }], error, { hasOperationError: true });
  }
  let charged = 0, admitted = false;
  let ledger = charges.get(accountingOwner);
  if (!ledger) { ledger = new Map(); charges.set(accountingOwner, ledger); }
  const account = {
    reserve(bytes) {
      if (bytes > maxDiskWorkingSetBytes - charged) throw Object.assign(new Error('Runtime destination working set exhausted.'), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
      shared.reserve(bytes); charged += bytes;
    },
    release(bytes) { shared.release(bytes); charged -= bytes; },
    get used() { return charged; }, limit: maxDiskWorkingSetBytes
  };
  let operationFailed = false, operationError;
  try {
    throwIfAborted(signal);
    for (const other of ledger.keys()) {
      if (other !== root && (root.startsWith(other + path.sep) || other.startsWith(root + path.sep))) {
        throw new TypeError('A shared runtime account cannot own overlapping destination scopes.');
      }
    }
    const retained = await inventory(root, signal);
    if (retained.retainedBytes > maxDiskWorkingSetBytes) throw Object.assign(new Error('Retained runtime destination exceeds its working-set allowance.'),
      { code: 'ERR_SEMANTIC_DISK_LIMIT', retainedBytes: retained.retainedBytes });
    const prior = ledger.get(root) || 0;
    charged = prior;
    if (retained.retainedBytes > prior) account.reserve(retained.retainedBytes - prior);
    else account.release(prior - retained.retainedBytes);
    admitted = true;
    const receipt = Buffer.from(JSON.stringify({ schemaVersion: 1, maxDiskWorkingSetBytes }));
    const filename = path.join(root, receiptName);
    let oldBytes = 0;
    try { oldBytes = (await fs.lstat(filename)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const oldReceipt = await readVerifiedContainedFile(root, filename, { maxBytes: 1024, signal })
      .catch(error => { if (error.code === 'ENOENT') return { buffer: Buffer.alloc(0) }; throw error; });
    if (!oldReceipt.buffer.equals(receipt)) {
      account.reserve(receipt.length);
      await atomicWriteText(filename, receipt, { newline: false });
      account.release(oldBytes);
    }
    return await operation({ destination: root, account });
  } catch (error) { operationFailed = true; operationError = error; throw error; }
  finally {
    const cleanupErrors = [];
    try {
      if (admitted) {
        try {
          const retained = (await inventory(root, null)).retainedBytes;
          if (retained > charged) account.reserve(retained - charged);
          else account.release(charged - retained);
        } finally { ledger.set(root, charged); }
      }
    } catch (error) { cleanupErrors.push(error); }
    try {
      await lock.release();
      // Only confirmed removal returns these exact lock credits.
      if (admitted) account.release(lockBytes);
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
