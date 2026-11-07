import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildToolInstallReceipt, writeToolInstallReceipt, readToolInstallReceipts } from '../../../tools/tooling/install-receipts.js';
import { getToolReceiptResourceSession, isToolReceiptResourceSession, assertToolReceiptFailureSettled } from '../../../tools/tooling/receipt-resource-owner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual ordinary receipt files/Dir handles with inert boundary
// faults. No installer, executable, child, network, symlink or user cache work.
const root = await makeTempDir('poc-tool-receipt-resource-');
const write = fs.writeFileSync, link = fs.linkSync, remove = fs.rmSync, opendir = fs.opendirSync;
const directories = [];
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const checkReceipt = (session, receipt) => assert.deepEqual(receipt, { resourceId: session.resourceId, settled: true, pending: false });
try {
  const consumer = path.join(root, 'inert-consumer');
  write(consumer, 'actual consumer bytes, never executed');
  const receipt = buildToolInstallReceipt({ tool: { id: 'receipt-resource-fixture' }, toolingRoot: root,
    result: { path: consumer, probe: { ok: false } } });
  const target = writeToolInstallReceipt(root, receipt), directory = path.dirname(target);
  const targetBefore = fs.readFileSync(target);
  for (const value of [undefined, null, false, 0, '']) {
    let temporary, removes = 0;
    fs.writeFileSync = (file, ...args) => {
      if (path.dirname(file) !== directory || !file.endsWith('.tmp')) return write(file, ...args);
      temporary = file; write(file, ...args); throw value;
    };
    fs.rmSync = (file, ...args) => { if (file === temporary) removes += 1; return remove(file, ...args); };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    assert.equal(failure.cause.cause, value);
    assert.equal(removes, 0, 'a thrown write return cannot grant ownership of a possibly created temporary');
    assert.equal(fs.existsSync(temporary), true);
    assert.deepEqual(fs.readFileSync(target), targetBefore);
    assertToolReceiptFailureSettled(failure);
    fs.writeFileSync = write; fs.rmSync = remove;
    remove(temporary);
  }
  for (const value of [false, 0, '']) {
    let temporary, denyCleanup = true, removes = 0, links = 0;
    fs.linkSync = (file) => { temporary = file; links += 1; throw value; };
    fs.rmSync = (file, ...args) => { if (file === temporary) { removes += 1; if (denyCleanup) throw null; } return remove(file, ...args); };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    assert.equal(failure.cause.cause, value); assert.equal(contains(failure, null), true);
    const session = getToolReceiptResourceSession(failure);
    assert.equal(isToolReceiptResourceSession(session), true); assert.equal(session.isSettled(), false);
    assert.throws(() => assertToolReceiptFailureSettled(failure), error => error === failure);
    denyCleanup = false; checkReceipt(session, session.releaseAfterClose());
    assert.equal(removes, 2); assert.equal(links, 1); assert.equal(fs.existsSync(temporary), false);
    assert.equal(failure.cacheOwnershipReleased(), true); assertToolReceiptFailureSettled(failure);
    fs.linkSync = link; fs.rmSync = remove;
  }
  {
    let temporary, removes = 0, allowed = false;
    fs.rmSync = (file, ...args) => {
      if (path.dirname(file) === directory && file.endsWith('.tmp')) {
        temporary = file; removes += 1; if (!allowed) return false;
      }
      return remove(file, ...args);
    };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(fs.existsSync(temporary), true); assert.equal(session.isSettled(), false);
    allowed = true; checkReceipt(session, session.releaseAfterClose());
    assert.equal(removes, 2); assert.deepEqual(fs.readFileSync(target), targetBefore); fs.rmSync = remove;
  }
  for (const marker of [undefined, false, true]) {
    let temporary, originalSettled = false, removes = 0, links = 0;
    const primary = Object.assign(new Error('original publication work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, primary); return originalSettled; }
    });
    fs.linkSync = file => { links += 1; temporary = file; throw primary; };
    fs.rmSync = (file, ...args) => { if (file === temporary) removes += 1; return remove(file, ...args); };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(removes, 0); assert.equal(fs.existsSync(temporary), true);
    primary.cacheOwnershipReleased = () => true;
    caught(() => session.releaseAfterClose()); assert.equal(removes, 0);
    originalSettled = true; checkReceipt(session, session.releaseAfterClose());
    assert.equal(removes, 1); assert.equal(links, 1); assert.deepEqual(fs.readFileSync(target), targetBefore);
    fs.linkSync = link; fs.rmSync = remove;
  }
  {
    let temporary, removes = 0, nativeSettled = false;
    const inspection = Object.assign(new Error('message getter owns independent native work'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return nativeSettled; }
    });
    const primary = new Error('diagnostic before cleanup'); delete primary.stack;
    Object.freeze(Object.defineProperty(primary, 'message', { get() { throw inspection; } }));
    fs.linkSync = file => { temporary = file; throw primary; };
    fs.rmSync = (file, ...args) => { if (file === temporary) removes += 1; return remove(file, ...args); };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    assert.equal(contains(failure, inspection), true); assert.equal(removes, 0);
    const session = getToolReceiptResourceSession(failure);
    inspection.cacheOwnershipReleased = () => true;
    caught(() => session.releaseAfterClose()); assert.equal(removes, 0);
    nativeSettled = true; checkReceipt(session, session.releaseAfterClose()); assert.equal(removes, 1);
    fs.linkSync = link; fs.rmSync = remove;
  }
  {
    let temporary, moved, removes = 0;
    const primary = Object.freeze(new Error('publication path was replaced'));
    fs.linkSync = file => {
      temporary = file; moved = `${file}.preserved`;
      fs.renameSync(file, moved); write(file, 'unrelated replacement bytes', { flag: 'wx' }); throw primary;
    };
    fs.rmSync = (file, ...args) => { if (file === temporary) removes += 1; return remove(file, ...args); };
    const failure = caught(() => writeToolInstallReceipt(root, receipt));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(removes, 0); assert.equal(fs.readFileSync(temporary, 'utf8'), 'unrelated replacement bytes');
    caught(() => session.releaseAfterClose()); assert.equal(removes, 0);
    // The fixture restores its original object explicitly; the owner never
    // searches for moved bytes or treats the replacement as cleanup authority.
    remove(temporary); fs.renameSync(moved, temporary);
    checkReceipt(session, session.releaseAfterClose()); assert.equal(removes, 1);
    fs.linkSync = link; fs.rmSync = remove;
  }
  for (const marker of [undefined, false, true]) {
    let reads = 0, closes = 0, originalSettled = false, wrapper;
    const primary = Object.assign(new Error('actual inventory read native work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, primary); return originalSettled; }
    });
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      wrapper = { readSync() { assert.equal(this, wrapper); reads += 1; throw primary; },
        closeSync() { assert.equal(this, wrapper); closes += 1; return actual.closeSync(); } };
      return wrapper;
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(closes, 0); primary.cacheOwnershipReleased = () => true;
    wrapper.closeSync = () => { throw new Error('replacement close cannot be consulted'); };
    caught(() => session.releaseAfterClose()); assert.equal(closes, 0);
    originalSettled = true; checkReceipt(session, session.releaseAfterClose());
    assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.opendirSync = opendir;
  }
  for (const value of [undefined, null, false, 0, '']) {
    let reads = 0, closes = 0, allowed = false;
    const closeFailure = Object.freeze(new Error('original actual Dir close failed'));
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      return { readSync() { reads += 1; throw value; }, closeSync() { closes += 1; if (!allowed) throw closeFailure; return actual.closeSync(); } };
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    assert.equal(failure.cause.cause, value); assert.equal(contains(failure, closeFailure), true);
    const session = getToolReceiptResourceSession(failure);
    allowed = true; checkReceipt(session, session.releaseAfterClose()); assert.equal(closes, 2); assert.equal(reads, 1);
    assert.equal(getToolReceiptResourceSession({ toolReceiptResourceSession: session }), null);
    assert.equal(Object.keys(failure).includes('toolReceiptResourceSession'), false);
    assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
    fs.opendirSync = opendir;
  }
  {
    let closes = 0, allowed = false;
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      return { readSync: actual.readSync.bind(actual), closeSync() { closes += 1; if (!allowed) return false; return actual.closeSync(); } };
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(session.isSettled(), false); assert.equal(closes, 1);
    allowed = true; checkReceipt(session, session.releaseAfterClose()); assert.equal(closes, 2); fs.opendirSync = opendir;
  }
  {
    let closes = 0;
    let ready = false, reads = 0;
    const inspection = Object.assign(new Error('inventory message diagnostic native work'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return ready; }
    });
    const primary = new Error('actual Dir read diagnostic'); delete primary.stack;
    Object.freeze(Object.defineProperty(primary, 'message', { get() { throw inspection; } }));
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      return { readSync() { reads += 1; throw primary; }, closeSync() { closes += 1; return actual.closeSync(); } };
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    const session = getToolReceiptResourceSession(failure);
    assert.equal(contains(failure, inspection), true); assert.equal(closes, 0);
    inspection.cacheOwnershipReleased = () => true;
    caught(() => session.releaseAfterClose()); assert.equal(closes, 0);
    ready = true; checkReceipt(session, session.releaseAfterClose()); assert.equal(closes, 1); assert.equal(reads, 1);
    fs.opendirSync = opendir;
  }
  {
    let closes = 0;
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      return { readSync: actual.readSync.bind(actual), closeSync() { closes += 1; return true; } };
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    const session = getToolReceiptResourceSession(failure);
    caught(() => session.releaseAfterClose()); assert.equal(closes, 1, 'unknown synchronous close evidence cannot authorize another native invocation');
    assert.equal(session.isSettled(), false); fs.opendirSync = opendir;
  }
  {
    let closes = 0;
    const primary = Object.freeze(Object.assign(new Error('unknown inventory resource'), { cacheOwnershipPending: true }));
    fs.opendirSync = (...args) => {
      const actual = opendir(...args); directories.push(actual);
      return { readSync() { throw primary; }, closeSync() { closes += 1; return actual.closeSync(); } };
    };
    const failure = caught(() => readToolInstallReceipts(root, receipt.toolId));
    caught(() => getToolReceiptResourceSession(failure).releaseAfterClose());
    assert.equal(closes, 0); fs.opendirSync = opendir;
  }
  assert.deepEqual(fs.readFileSync(target), targetBefore);
  assert.equal(readToolInstallReceipts(root, receipt.toolId).length, 1);
} finally {
  fs.writeFileSync = write; fs.linkSync = link; fs.rmSync = remove; fs.opendirSync = opendir;
  // Raw fixture disposal is never settlement evidence for an unknown owner.
  for (const directory of directories) { try { directory.closeSync(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Receipt publication and inventory preserve original synchronous resource ownership.');
