import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { verifyStorageFile, isStorageTransferSession } from '../../../src/shared/storage/transfer.js';
import { inspectManagedInstallation } from '../../../tools/tooling/managed-install.js';

// UNVALIDATED: actual source/output FileHandles, with inert close/read failures.
const temporary = await makeTempDir('poc-transfer-descriptor-close-');
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) { const current = pending.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue; seen.add(current);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : [])); }
  return false;
};
const open = fs.open;
try {
  const source = path.join(temporary, 'source.bin'), destination = path.join(temporary, 'destination.bin');
  const bytes = Buffer.alloc(128 * 1024, 0x41);
  await fs.writeFile(source, bytes);
  const primary = Object.freeze(Object.assign(new Error('frozen source read failed'), { code: 'EIO' }));
  const sourceClose = Object.freeze(Object.assign(new Error('frozen source close failed'), { code: 'EBUSY' }));
  const outputClose = Object.freeze(Object.assign(new Error('frozen output close failed'), { code: 'EACCES' }));
  const denied = new Set(['source', 'output']);
  const attempts = { source: 0, output: 0 };
  const closeReads = { source: 0, output: 0 }, wrappers = new Map();
  let replacedClose = false;
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    const role = target === source ? 'source' : target === destination ? 'output' : null;
    if (!role) return handle;
    const wrapped = new Proxy(handle, { get(owner, property) {
      if (property === 'read' && role === 'source') return async () => { throw primary; };
      if (property === 'close') {
        closeReads[role]++;
        if (replacedClose) return () => assert.fail('exact transfer retry cannot adopt a replacement descriptor close method');
        return async function () {
          assert.equal(this, wrappers.get(role));
          attempts[role]++;
          if (denied.has(role)) throw role === 'source' ? sourceClose : outputClose;
          await owner.close();
        };
      }
      const value = Reflect.get(owner, property, owner);
      return typeof value === 'function' ? value.bind(owner) : value;
    } });
    wrappers.set(role, wrapped); return wrapped;
  };
  let failure;
  try { await verifyStorageFile({ root: temporary, file: source, destination }); } catch (error) { failure = error; }
  assert.deepEqual(attempts, { source: 1, output: 1 }, 'failed output close cannot skip independently owned input close');
  for (const original of [primary, sourceClose, outputClose]) assert.equal(contains(failure, original), true);
  assert.equal(failure.code, 'EIO');
  assert.equal(failure.cacheOwnershipReleased(), false);
  const held = failure.storageTransferSession;
  assert.equal(isStorageTransferSession(held), true);
  assert.equal(isStorageTransferSession({ ...held }), false, 'copied method/property data does not supply producer identity');
  assert.equal(Object.keys(failure).includes('storageTransferSession'), false);
  assert.deepEqual(closeReads, { source: 1, output: 1 });
  replacedClose = true;
  denied.delete('source');
  let latest;
  try { await held.releaseAfterClose(); } catch (error) { latest = error; }
  assert.equal(latest.storageTransferSession, held);
  assert.deepEqual(attempts, { source: 2, output: 2 });
  assert.equal(failure.cacheOwnershipReleased(), false);
  denied.clear();
  const receipts = await Promise.all([held.releaseAfterClose(), held.releaseAfterClose()]);
  assert.deepEqual(receipts, [{ resourceId: held.resourceId, settled: true, pending: false },
    { resourceId: held.resourceId, settled: true, pending: false }]);
  assert.deepEqual(attempts, { source: 2, output: 3 }, 'actual confirmed close is not repeated on an already closed owner');
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.deepEqual(closeReads, { source: 1, output: 1 }, 'cleanup retains both exact original methods');
  fs.open = open;
  const copied = path.join(temporary, 'successful.bin');
  const successful = await verifyStorageFile({ root: temporary, file: source, destination: copied });
  assert.equal(successful.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await fs.readFile(copied), bytes);

  for (const known of [true, false]) for (const closeInitiallyDenied of [true, false]) {
    let confirmed = false, deny = closeInitiallyDenied;
    const native = Object.freeze(Object.assign(new Error('frozen independent transfer read owner'), { cacheOwnershipPending: true,
      ...(known ? { cacheOwnershipReleased() { return this === native && confirmed; } } : {}) }));
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      if (target !== source) return handle;
      return new Proxy(handle, { get(owner, property) {
        if (property === 'read') return async () => { throw native; };
        if (property === 'close') return async () => { if (deny) throw outputClose; await owner.close(); };
        const value = Reflect.get(owner, property, owner);
        return typeof value === 'function' ? value.bind(owner) : value;
      } });
    };
    let pending;
    try { await verifyStorageFile({ root: temporary, file: source }); } catch (error) { pending = error; }
    assert.equal(contains(pending, native), true);
    assert.equal(isStorageTransferSession(pending.storageTransferSession), true,
      'a pending read owner retains its branded session even when every descriptor already closed successfully');
    deny = false;
    await assert.rejects(pending.storageTransferSession.releaseAfterClose(), error => error.cacheOwnershipPending === true
      && error.cacheOwnershipReleased() === false, 'exact file close cannot override the original independent read owner');
    confirmed = true;
    if (known) {
      await pending.storageTransferSession.releaseAfterClose();
      assert.equal(pending.cacheOwnershipReleased(), true, 'the original observation retains its exact receiver');
    } else {
      await assert.rejects(pending.storageTransferSession.releaseAfterClose(), error => error.cacheOwnershipReleased() === false);
      assert.equal(pending.cacheOwnershipReleased(), false);
    }
    // The actual file handle has closed in both variants. Unknown independent
    // fixture evidence remains false without claiming a native owner settled.
    fs.open = open;
  }

  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const fixture = await createManagedCommandFixture(path.join(temporary, 'managed'));
    let deny = true;
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      if (target !== fixture.command) return handle;
      return new Proxy(handle, { get(owner, property) {
        if (property === 'close') return async () => { if (deny) throw outputClose; await owner.close(); };
        const value = Reflect.get(owner, property, owner);
        return typeof value === 'function' ? value.bind(owner) : value;
      } });
    };
    let pending;
    try { await inspectManagedInstallation({ toolingRoot: fixture.toolingRoot, toolId: fixture.toolId }); } catch (error) { pending = error; }
    assert.equal(isStorageTransferSession(pending.storageTransferSession), true,
      'actual managed inspection cannot flatten unclosed descriptor ownership to repair-required');
    deny = false;
    await pending.storageTransferSession.releaseAfterClose();
    assert.equal(pending.cacheOwnershipReleased(), true);
    fs.open = open;
    assert.equal((await inspectManagedInstallation({ toolingRoot: fixture.toolingRoot, toolId: fixture.toolId })).ok, true);
  });
} finally { fs.open = open; await rmDirRecursive(temporary); }
console.log('Storage transfer closes both descriptors and preserves exact close recovery.');
