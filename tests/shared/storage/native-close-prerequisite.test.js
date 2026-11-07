import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyStorageFile } from '../../../src/shared/storage/transfer.js';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual Dir/FileHandles with inert original native-work evidence.
const root = await makeTempDir('poc-storage-native-close-prerequisite-');
const open = fs.open, opendir = fs.opendir;
const files = [], directories = [];
const source = path.join(root, 'source.bin');
let sequence = 0;
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const receipt = (held, value) => assert.deepEqual(value, { resourceId: held.resourceId, settled: true, pending: false });
try {
  await fs.writeFile(source, 'actual storage source bytes');
  for (const flag of [undefined, false, true]) {
    let settled = false, closes = 0, reads = 0;
    const original = Object.assign(new Error('original Dir read native work'), {
      ...(flag === undefined ? {} : { cacheOwnershipPending: flag }),
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    fs.opendir = async (...args) => {
      const handle = await opendir(...args); directories.push(handle);
      const owned = {
        read() { assert.equal(this, owned); reads += 1; throw original; },
        async close() { assert.equal(this, owned); closes += 1; await handle.close(); }
      };
      return owned;
    };
    const failure = await rejected(() => withStorageDirectory(root, reader => reader.read()));
    assert.equal(contains(failure, original), true); assert.equal(closes, 0);
    const held = getStorageDirectorySession(failure);
    original.cacheOwnershipReleased = () => true;
    await rejected(() => held.releaseAfterClose()); assert.equal(closes, 0);
    settled = true; receipt(held, await held.releaseAfterClose());
    assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.opendir = opendir;
  }
  for (const flag of [undefined, false, true]) {
    const destination = path.join(root, `pending-write-${sequence++}.bin`);
    let settled = false, writes = 0;
    const closes = { source: 0, output: 0 };
    const original = Object.assign(new Error('original output native work'), {
      ...(flag === undefined ? {} : { cacheOwnershipPending: flag }),
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      const role = target === source ? 'source' : target === destination ? 'output' : null;
      if (!role) return handle;
      files.push(handle);
      let owned;
      owned = new Proxy(handle, { get(actual, field) {
        if (field === 'write' && role === 'output') return function () { assert.equal(this, owned); writes += 1; throw original; };
        if (field === 'close') return async function () { assert.equal(this, owned); closes[role] += 1; await actual.close(); };
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
      return owned;
    };
    const failure = await rejected(() => verifyStorageFile({ root, file: source, destination }));
    assert.equal(contains(failure, original), true); assert.deepEqual(closes, { source: 0, output: 0 });
    const held = failure.storageTransferSession;
    original.cacheOwnershipReleased = () => true;
    await rejected(() => held.releaseAfterClose()); assert.deepEqual(closes, { source: 0, output: 0 });
    settled = true; receipt(held, await held.releaseAfterClose());
    assert.deepEqual(closes, { source: 1, output: 1 }); assert.equal(writes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true); fs.open = open;
  }
  {
    const destination = path.join(root, 'close-secondary.bin');
    let settled = false, allowed = false;
    const closes = { source: 0, output: 0 };
    const original = Object.freeze(Object.assign(new Error('source close retains independent native work'), {
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    }));
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      const role = target === source ? 'source' : target === destination ? 'output' : null;
      if (!role) return handle;
      files.push(handle);
      return new Proxy(handle, { get(actual, field) {
        if (field === 'close') return async () => {
          closes[role] += 1;
          if (role === 'source' && !allowed) throw original;
          await actual.close();
        };
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    const failure = await rejected(() => verifyStorageFile({ root, file: source, destination }));
    assert.deepEqual(closes, { source: 1, output: 0 }, 'newly observed close failure gates remaining native destruction');
    await rejected(() => failure.storageTransferSession.releaseAfterClose()); assert.deepEqual(closes, { source: 1, output: 0 });
    settled = true; allowed = true;
    receipt(failure.storageTransferSession, await failure.storageTransferSession.releaseAfterClose());
    assert.deepEqual(closes, { source: 2, output: 1 }); fs.open = open;
  }

  // Unreadable original flags keep native destruction unknown while retaining
  // the exact independently owned inspection failure, rather than losing it.
  for (const kind of ['directory', 'file']) {
    let closes = 0, settled = false;
    const inspection = Object.freeze(Object.assign(new Error('native observer inspection resource'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
    }));
    const original = Object.freeze(Object.defineProperty(new Error('unreadable original native observation'), 'cacheOwnershipReleased', {
      get() { throw inspection; }
    }));
    if (kind === 'directory') fs.opendir = async (...args) => {
      const handle = await opendir(...args); directories.push(handle);
      return { read() { throw original; }, async close() { closes += 1; await handle.close(); } };
    };
    else fs.open = async (target, ...args) => {
      const handle = await open(target, ...args); if (target !== source) return handle; files.push(handle);
      return new Proxy(handle, { get(actual, field) {
        if (field === 'read') return () => { throw original; };
        if (field === 'close') return async () => { closes += 1; await actual.close(); };
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    const failure = await rejected(() => kind === 'directory' ? withStorageDirectory(root, reader => reader.read())
      : verifyStorageFile({ root, file: source }));
    assert.equal(contains(failure, original), true); assert.equal(contains(failure, inspection), true); assert.equal(closes, 0);
    const held = kind === 'directory' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
    settled = true; await rejected(() => held.releaseAfterClose()); assert.equal(closes, 0, 'unreadable original remains unknown');
    fs.open = open; fs.opendir = opendir;
  }

  // Exact same-owner outward failures do not become a circular prerequisite;
  // a lookalike merely carrying the actual capability remains independent.
  for (const kind of ['directory', 'file']) {
    let phase = 'initial', failure, held, lookalike, settled = false, closes = 0;
    const original = Object.freeze(new Error('original native close failed'));
    const closeActual = async handle => {
      closes += 1;
      if (phase === 'initial') throw original;
      if (phase === 'self') throw failure;
      if (phase === 'lookalike') throw lookalike;
      await handle.close();
    };
    if (kind === 'directory') fs.opendir = async (...args) => {
      const handle = await opendir(...args); directories.push(handle);
      return { read: handle.read.bind(handle), close: () => closeActual(handle) };
    };
    else fs.open = async (target, ...args) => {
      const handle = await open(target, ...args); if (target !== source) return handle; files.push(handle);
      return new Proxy(handle, { get(actual, field) {
        if (field === 'close') return () => closeActual(actual);
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    failure = await rejected(() => kind === 'directory' ? withStorageDirectory(root, reader => reader.read())
      : verifyStorageFile({ root, file: source }));
    held = kind === 'directory' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
    assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError,
      'a privately recognized self error cannot replace its owned settlement observer');
    phase = 'self'; await rejected(() => held.releaseAfterClose()); assert.equal(closes, 2);
    lookalike = Object.freeze(Object.assign(new Error('independent close lookalike'), {
      [kind === 'directory' ? 'storageDirectorySession' : 'storageTransferSession']: held,
      cacheOwnershipReleased() { assert.equal(this, lookalike); return settled; }
    }));
    phase = 'lookalike'; await rejected(() => held.releaseAfterClose()); assert.equal(closes, 3);
    phase = 'success'; await rejected(() => held.releaseAfterClose()); assert.equal(closes, 3);
    settled = true; receipt(held, await held.releaseAfterClose()); assert.equal(closes, 4);
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = open; fs.opendir = opendir;
  }
  for (const kind of ['directory', 'file']) {
    let allowed = false, closes = 0;
    const closeActual = async handle => { closes += 1; if (!allowed) return false; await handle.close(); };
    if (kind === 'directory') fs.opendir = async (...args) => {
      const handle = await opendir(...args); directories.push(handle);
      return { read: handle.read.bind(handle), close: () => closeActual(handle) };
    };
    else fs.open = async (target, ...args) => {
      const handle = await open(target, ...args); if (target !== source) return handle; files.push(handle);
      return new Proxy(handle, { get(actual, field) {
        if (field === 'close') return () => closeActual(actual);
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    const failure = await rejected(() => kind === 'directory' ? withStorageDirectory(root, reader => reader.read())
      : verifyStorageFile({ root, file: source }));
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    allowed = true;
    const held = kind === 'directory' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
    receipt(held, await held.releaseAfterClose()); assert.equal(closes, 2);
    fs.open = open; fs.opendir = opendir;
  }
} finally {
  fs.open = open; fs.opendir = opendir;
  // Fixture disposal of native resources never supplies a settlement receipt
  // for deliberately unreadable/missing independent original evidence.
  for (const directory of directories) { try { await directory.close(); } catch {} }
  for (const handle of files) { try { await handle.close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Actual storage Dir/FileHandle native close requires original resource settlement.');
