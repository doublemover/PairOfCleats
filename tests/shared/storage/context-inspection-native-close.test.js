import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { verifyStorageFile } from '../../../src/shared/storage/transfer.js';
import { readStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable Dir/FileHandles; only explicit close retries,
// never replay of the original read or use of fields/cause as release evidence.
const root = await makeTempDir('poc-storage-context-native-close-');
const source = path.join(root, 'source.bin');
const open = fs.open, opendir = fs.opendir, files = [], directories = [];
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
try {
  await fs.writeFile(source, 'original disposable transfer bytes');
  for (const kind of ['directory', 'file']) {
    for (const inspected of ['message', 'code']) {
      let reads = 0, closes = 0, getterReads = 0, allowClose = false, inspectionSettled = false;
      const inspection = Object.assign(new Error('diagnostic getter retained native work'), {
        cacheOwnershipPending: false,
        cacheOwnershipReleased() { assert.equal(this, inspection); return inspectionSettled; }
      });
      const primary = new Error('original failed read');
      delete primary.stack;
      Object.freeze(Object.defineProperty(primary, inspected, {
        enumerable: inspected === 'code', get() { assert.equal(this, primary); getterReads += 1; throw inspection; }
      }));
      const closeOriginal = async handle => {
        closes += 1;
        if (!allowClose) throw Object.freeze(new Error('initial actual close remains unconfirmed'));
        await handle.close();
      };
      if (kind === 'directory') fs.opendir = async (...args) => {
        const actual = await opendir(...args); directories.push(actual);
        return { read() { reads += 1; throw primary; }, close: () => closeOriginal(actual) };
      };
      else fs.open = async (target, ...args) => {
        const actual = await open(target, ...args); if (target !== source) return actual; files.push(actual);
        return new Proxy(actual, { get(handle, field) {
          if (field === 'read') return () => { reads += 1; throw primary; };
          if (field === 'close') return () => closeOriginal(handle);
          const value = Reflect.get(handle, field, handle); return typeof value === 'function' ? value.bind(handle) : value;
        } });
      };
      const failure = await rejected(() => kind === 'directory' ? withStorageDirectory(root, directory => directory.read())
        : verifyStorageFile({ root, file: source }));
      const held = kind === 'directory' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
      assert.ok(held); assert.equal(closes, 1); assert.equal(reads, 1);
      if (inspected === 'code') {
        assert.equal(getterReads, 0, 'copying an accessor never invokes the original diagnostic getter');
        assert.throws(() => failure.code, error => error === inspection);
      }
      assert.equal(getterReads, 1);
      assert.equal(readStorageFailureContext(failure).inspectionErrors.includes(inspection), true);
      allowClose = true;
      // Replacing the observed method cannot manufacture settlement evidence.
      inspection.cacheOwnershipReleased = () => true;
      Object.freeze(inspection);
      await rejected(() => held.releaseAfterClose());
      assert.equal(closes, 1, 'actual diagnostic inspection observer gates the original native close retry');
      inspectionSettled = true;
      assert.deepEqual(await held.releaseAfterClose(), { resourceId: held.resourceId, settled: true, pending: false });
      assert.equal(closes, 2); assert.equal(reads, 1);
      assert.equal(failure.cacheOwnershipReleased(), true);
      fs.open = open; fs.opendir = opendir;
    }
  }
  for (const kind of ['directory', 'file']) {
    let closes = 0, reads = 0, primaryReady = false, throwObservation = true, inspectorReady = false;
    const inspection = Object.freeze(Object.assign(new Error('original observer threw independent work'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return inspectorReady; }
    }));
    const primary = Object.freeze(Object.assign(new Error('read work before native close'), {
      cacheOwnershipReleased() {
        assert.equal(this, primary);
        if (throwObservation) throw inspection;
        return primaryReady;
      }
    }));
    if (kind === 'directory') fs.opendir = async (...args) => {
      const actual = await opendir(...args); directories.push(actual);
      return { read() { reads += 1; throw primary; }, async close() { closes += 1; await actual.close(); } };
    };
    else fs.open = async (target, ...args) => {
      const actual = await open(target, ...args); if (target !== source) return actual; files.push(actual);
      return new Proxy(actual, { get(handle, field) {
        if (field === 'read') return () => { reads += 1; throw primary; };
        if (field === 'close') return async () => { closes += 1; await handle.close(); };
        const value = Reflect.get(handle, field, handle); return typeof value === 'function' ? value.bind(handle) : value;
      } });
    };
    const failure = await rejected(() => kind === 'directory' ? withStorageDirectory(root, directory => directory.read())
      : verifyStorageFile({ root, file: source }));
    const held = kind === 'directory' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
    assert.equal(closes, 0); throwObservation = false; primaryReady = true;
    await rejected(() => held.releaseAfterClose()); assert.equal(closes, 0);
    inspectorReady = true;
    assert.deepEqual(await held.releaseAfterClose(), { resourceId: held.resourceId, settled: true, pending: false });
    assert.equal(closes, 1); assert.equal(reads, 1);
    fs.open = open; fs.opendir = opendir;
  }
} finally {
  fs.open = open; fs.opendir = opendir;
  // Disposal has no authority to settle deliberately unknown original work.
  for (const directory of directories) { try { await directory.close(); } catch {} }
  for (const handle of files) { try { await handle.close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Original diagnostic inspection resources gate actual native close retries.');
