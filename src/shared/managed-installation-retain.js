// Source UNVALIDATED: runtime consumers must bind release to actual resource settlement.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath, withContainedFileSync, getContainedFileSession } from './contained-file.js';
import { readManagedToolText } from './managed-tool-file.js';
import { stableStringify } from './stable-json.js';
import { acquireStorageSession, retainSessionFailure } from './storage/session.js';
import { resolveStorageLayout } from './storage/layout.js';
import { isKnownManagedInstallationReceipt } from './managed-installation-contract.js';
import { withStorageDirectorySync, getStorageDirectorySession } from './storage/directory.js';
import { describeStorageFailure, observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';

const identity = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const safeRelative = value => typeof value === 'string' && value.length <= 4096
  && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part));
const boundedJson = file => JSON.parse(readManagedToolText(file, 8 * 1024 * 1024));

const inventory = root => {
  const rows = [];
  const pending = [''];
  let entries = 0;
  let bytes = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = path.join(root, relative);
    assertNoSymlinkPath(root, directory);
    withStorageDirectorySync(directory, reader => {
      for (let entry = reader.read(); entry; entry = reader.read()) {
        if (++entries > 50000) throw new Error('Managed inventory exceeds its entry bound.');
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (!safeRelative(child)) throw new Error('Invalid managed inventory path.');
        if (entry.isDirectory()) { pending.push(child); continue; }
        const file = path.join(root, child);
        assertNoSymlinkPath(root, file);
        const before = fs.lstatSync(file);
        if (!before.isFile() || before.nlink !== 1 || before.size > 128 * 1024 * 1024) throw new Error('Invalid managed inventory file.');
        bytes += before.size;
        if (bytes > 1024 * 1024 * 1024) throw new Error('Managed inventory exceeds its byte bound.');
        const sha256 = withContainedFileSync(root, file, descriptor => {
          const opened = descriptor.stat();
          if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('Managed file changed before reading.');
          const hash = createHash('sha256');
          const buffer = Buffer.allocUnsafe(65536);
          let offset = 0;
          while (offset < before.size) {
            const wanted = Math.min(buffer.length, before.size - offset);
            const count = descriptor.read(buffer, 0, wanted, offset);
            if (!Number.isSafeInteger(count) || count <= 0 || count > wanted) throw new Error('Managed file made invalid read progress.');
            hash.update(buffer.subarray(0, count));
            offset += count;
          }
          const after = descriptor.stat();
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('Managed file changed while reading.');
          return hash.digest('hex');
        });
        rows.push({ path: child, bytes: before.size, sha256 });
      }
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
};

/** Full immutable-generation inspection, without executable/version probes. */
export const inspectManagedInstallationSync = ({ toolingRoot, toolId, descriptorId = null, installId = null } = {}) => {
  try {
    if (!path.isAbsolute(toolingRoot || '') || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(toolId || '')) throw new Error('Invalid managed owner.');
    assertNoSymlinkPath(path.parse(toolingRoot).root, toolingRoot);
    const physical = fs.realpathSync(toolingRoot);
    const owner = path.join(physical, 'installs', toolId);
    assertNoSymlinkPath(physical, owner);
    const selector = boundedJson(path.join(owner, 'current.json'));
    if (!/^[a-f0-9]{64}$/.test(selector?.installId || '') || !/^[a-f0-9]{64}$/.test(selector?.descriptorId || '')) throw new Error('Invalid managed selector.');
    if ((descriptorId && selector.descriptorId !== descriptorId) || (installId && selector.installId !== installId)) return { ok: false, state: 'different-selected-version', selector };
    const expected = { schemaVersion: 1, toolId, descriptorId: selector.descriptorId, installId: selector.installId };
    if (identity(selector) !== identity(expected)) throw new Error('Managed selector ownership disagrees.');
    const receiptPath = path.join(owner, 'receipts', selector.installId + '.json');
    assertNoSymlinkPath(owner, receiptPath);
    const receipt = boundedJson(receiptPath);
    const root = path.join(owner, 'generations', selector.installId);
    const descriptor = receipt.descriptor;
    if (!isKnownManagedInstallationReceipt(receipt) || receipt.schemaVersion !== 1 || receipt.application !== 'pairofcleats' || receipt.toolId !== toolId
      || receipt.installId !== selector.installId || receipt.descriptorId !== selector.descriptorId || receipt.root !== root
      || receipt.selectorIdentity !== identity(expected) || identity(descriptor) !== selector.descriptorId
      || descriptor?.schemaVersion !== 1 || descriptor.toolId !== toolId || descriptor.platform !== process.platform || descriptor.arch !== process.arch
      || !safeRelative(descriptor.command) || !Array.isArray(descriptor.args || []) || (descriptor.args || []).some(arg => typeof arg !== 'string')
      || !Array.isArray(receipt.files) || identity(receipt.files) !== receipt.filesIdentity) throw new Error('Managed generation ownership disagrees.');
    assertNoSymlinkPath(owner, root);
    if (identity(inventory(root)) !== receipt.filesIdentity) return { ok: false, state: 'repair-required', reason: 'managed-file-bytes-drift', receipt };
    if (!receipt.files.some(file => file.path === descriptor.command)) throw new Error('Managed consumer is absent from its inventory.');
    return { ok: true, state: 'bytes-intact', owner, root, command: path.join(root, descriptor.command), args: descriptor.args || [], receipt, protocol: 'not-reprobed' };
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'managed-generation-inspection', defaultCode: null });
    return { ok: false, state: diagnostic.code === 'ENOENT' ? 'missing' : 'repair-required', reason: diagnostic.code || diagnostic.message };
  }
};

/** Pin category and exact owner, then repeat full byte inspection under admission.
 * No child is launched here. A caller must retain this handle until actual child,
 * descendant and resource closure has been confirmed by its execution owner.
 */
export const retainManagedToolInstallationSync = options => {
  if (!path.isAbsolute(options?.toolingRoot || '') || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(options?.toolId || '')) {
    throw new Error('Managed tool selection is unavailable: invalid owner');
  }
  const owner = path.join(options.toolingRoot, 'installs', options.toolId);
  const stateRoot = resolveStorageLayout({ overrides: { tooling: options.toolingRoot } }).descriptors.state.path;
  const coordinationRoot = path.join(stateRoot, 'storage-access');
  const session = acquireStorageSession({ roots: [owner],
    authorizedRoots: [options.toolingRoot, stateRoot], coordinationRoot,
    scope: 'managed-physical-installation-resource' });
  const release = () => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
  try {
    const selected = inspectManagedInstallationSync(options);
    if (!selected.ok) throw new Error('Managed tool selection is unavailable: ' + selected.state);
    const after = inspectManagedInstallationSync({ ...options, descriptorId: selected.receipt.descriptorId,
      installId: selected.receipt.installId });
    if (!after.ok) throw new Error('Managed tool selection changed before consumer lease admission; retry.');
    return Object.defineProperty({ ...after, release }, 'storageSession', { value: session });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'managed-retained-inspection' });
    let pending = false, retained = error;
    try { observation.requireSettled(); } catch (failure) { pending = true; retained = failure; }
    if (pending) {
      const file = getContainedFileSession(retained), directory = getStorageDirectorySession(retained);
      let released = false;
      const retain = secondary => retainSessionFailure(addStorageFailureContext(retained,
        { managedInspectionSession: recovery }, secondary, { nonEnumerable: ['managedInspectionSession'], forceAggregate: true }),
      null, session, { originalClosure: () => released && observation.isSettled() });
      const recovery = Object.freeze({ resourceId: session.resourceId, releaseAfterClosure: () => {
        try {
          file?.releaseAfterCloseSync(); directory?.releaseAfterCloseSync();
          observation.requireSettled();
          if (release() !== true) throw new Error('Managed inspection storage metadata remains unconfirmed.');
          released = true; return true;
        } catch (cleanupError) { throw retain(cleanupError); }
      } });
      throw retain();
    }
    try { release(); }
    catch (cleanupError) { throw retainSessionFailure(error, cleanupError, session); }
    throw error;
  }
};

export const retainManagedToolInstallation = async options => retainManagedToolInstallationSync(options);
