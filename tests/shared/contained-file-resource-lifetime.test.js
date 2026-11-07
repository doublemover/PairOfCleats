import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getContainedFileSession, isContainedFileSession, openContainedFile,
  readVerifiedContainedFile, withContainedFile } from '../../src/shared/contained-file.js';
import { withVerifiedArtifactReadScope } from '../../src/shared/artifact-io/verified-read-scope.js';
import { runWithSchedulerTaskLease } from '../../src/shared/concurrency/scheduler-task-scope.js';
import { inspectReusableDictionary } from '../../tools/download/dictionary-reuse.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: actual tiny FileHandles, inert faults and scheduler adapters.
// No child/native binding/network/physical-link/executable operations.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-contained-resource-'), originalOpen = fs.open;
const disposal = [];
try {
  const file = path.join(root, 'data'), bytes = Buffer.from('actual bounded dictionary bytes\n');
  await fs.writeFile(file, bytes);
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const scope = (record, action) => withVerifiedArtifactReadScope({ root, record }, action);
  let records = 0;
  const valid = await scope(() => { records += 1; }, () => readVerifiedContainedFile(root, file, {
    maxBytes: bytes.length, expectedHash
  }));
  assert.deepEqual(valid.buffer, bytes); assert.equal(records, 1);
  assert.equal(JSON.stringify(valid).includes('fileIdentity'), false);

  for (const verifiedRead of [true, false]) {
    let allowClose = false, closes = 0, reads = 0, stats = 0, closeGets = 0, readGets = 0, statGets = 0;
    const closeError = Object.freeze(Object.assign(new Error('original descriptor close rejected'), { code: 'ECLOSE' }));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args); disposal.push(() => handle.close());
      const close = handle.close.bind(handle), read = handle.read.bind(handle), stat = handle.stat.bind(handle);
      const originalClose = async function () { assert.equal(this, handle); closes += 1; if (!allowClose) throw closeError; return close(); };
      const originalRead = function (...input) {
        assert.equal(this, handle); reads += 1;
        Object.defineProperties(handle, { close: { value: () => assert.fail('replacement close') },
          read: { value: () => assert.fail('replacement read') }, stat: { value: () => assert.fail('replacement stat') } });
        return read(...input);
      };
      Object.defineProperties(handle, {
        close: { configurable: true, get() { closeGets += 1; return originalClose; } },
        read: { configurable: true, get() { readGets += 1; return originalRead; } },
        stat: { configurable: true, get() { statGets += 1; return function (...input) { assert.equal(this, handle); stats += 1; return stat(...input); }; } }
      });
      // Teardown uses the real native method, independent of the public replacement.
      disposal[disposal.length - 1] = close;
      return handle;
    };
    records = 0;
    const failure = await rejected(() => scope(() => { records += 1; }, () => verifiedRead
      ? readVerifiedContainedFile(root, file)
      : withContainedFile(root, file, async descriptor => {
        const before = await descriptor.stat(), buffer = Buffer.alloc(before.size);
        const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, 0);
        assert.equal(bytesRead, bytes.length); assert.deepEqual(buffer, bytes);
        assert.equal((await descriptor.stat()).size, before.size);
        descriptor.verify();
      })));
    const session = getContainedFileSession(failure);
    assert.equal(isContainedFileSession(session), true); assert.equal(contains(failure, closeError), true);
    assert.equal(failure.code, 'ECLOSE'); assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
    const expectedStats = verifiedRead ? 0 : 2;
    assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(stats, expectedStats); assert.equal(records, 0);
    assert.deepEqual([closeGets, readGets, statGets], [1, 1, 1]);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
    allowClose = true;
    const receipts = await Promise.all([session.releaseAfterClose(), session.releaseAfterClose()]);
    for (const receipt of receipts) assert.deepEqual(receipt, { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(closes, 2); assert.equal(reads, 1); assert.equal(stats, expectedStats); assert.equal(records, 0);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const value of [undefined, null, false, 0, '']) {
    let closes = 0, allowClose = false;
    const secondary = Object.freeze(new Error('independent close error'));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.read = async () => { throw value; };
      handle.close = async () => { closes += 1; if (!allowClose) throw secondary; return close(); };
      return handle;
    };
    const failure = await rejected(() => readVerifiedContainedFile(root, file));
    assert.equal(contains(failure, value), true); assert.equal(contains(failure, secondary), true); assert.equal(closes, 1);
    allowClose = true; await getContainedFileSession(failure).releaseAfterClose();
    assert.equal(closes, 2); assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const marker of [undefined, false, true]) {
    let settled = false, closes = 0, reads = 0;
    const primary = Object.assign(new Error('original native read remains owned'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.read = async () => { reads += 1; throw primary; };
      handle.close = async () => { closes += 1; return close(); }; return handle;
    };
    const failure = await rejected(() => readVerifiedContainedFile(root, file));
    const session = getContainedFileSession(failure);
    assert.equal(contains(failure, primary), true); assert.equal(closes, 0); assert.equal(reads, 1);
    primary.cacheOwnershipReleased = () => true;
    await rejected(() => session.releaseAfterClose()); assert.equal(closes, 0);
    settled = true; await session.releaseAfterClose(); assert.equal(closes, 1); assert.equal(reads, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let closes = 0;
    const primary = Object.freeze(Object.assign(new Error('unknown original read work'), { cacheOwnershipPending: true }));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.read = async () => { throw primary; }; handle.close = async () => { closes += 1; return close(); }; return handle;
    };
    const failure = await rejected(() => readVerifiedContainedFile(root, file));
    const session = getContainedFileSession(failure);
    await rejected(() => session.releaseAfterClose()); assert.equal(closes, 0);
    await disposal[disposal.length - 1]();
    assert.equal(session.isSettled(), false, 'external inert disposal cannot supply a missing independent native observer');
  }
  {
    let inspected = false, closes = 0;
    const inspection = Object.assign(new Error('original diagnostic inspector owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return inspected; }
    });
    const primary = new Error('replace before freeze'); delete primary.stack;
    Object.freeze(Object.defineProperty(primary, 'message', { get() { throw inspection; } }));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.read = async () => { throw primary; }; handle.close = async () => { closes += 1; return close(); }; return handle;
    };
    const failure = await rejected(() => readVerifiedContainedFile(root, file));
    assert.equal(closes, 0); assert.equal(contains(failure, primary), true);
    inspection.cacheOwnershipReleased = () => true;
    await rejected(() => getContainedFileSession(failure).releaseAfterClose()); assert.equal(closes, 0);
    inspected = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(closes, 1);
  }
  {
    let allowClose = false, closes = 0, reads = 0;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle), read = handle.read.bind(handle); disposal.push(close);
      handle.read = (...input) => { reads += 1; return read(...input); };
      handle.close = async () => { closes += 1; if (!allowClose) throw 0; return close(); }; return handle;
    };
    const stat = await fs.stat(file, { bigint: true });
    const failure = await rejected(() => openContainedFile(root, file, {
      expectedFileIdentity: { dev: String(stat.dev), ino: String(stat.ino + 1n) }
    }));
    assert.equal(failure.code, 'ERR_FILE_CHANGED'); assert.equal(contains(failure, 0), true);
    assert.equal(reads, 0); assert.equal(closes, 1); allowClose = true;
    await getContainedFileSession(failure).releaseAfterClose(); assert.equal(reads, 0); assert.equal(closes, 2);
  }
  {
    let allowClose = false, inspectionSettled = false, closes = 0;
    const inspection = Object.assign(new Error('late original diagnostic inspector'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return inspectionSettled; }
    });
    const primary = Object.freeze(Object.defineProperty(new Error('original read with late code inspection'), 'code', {
      get() { assert.equal(this, primary); throw inspection; }
    }));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.read = async () => { throw primary; };
      handle.close = async () => { closes += 1; if (!allowClose) throw new Error('known close denial'); return close(); }; return handle;
    };
    const failure = await rejected(() => readVerifiedContainedFile(root, file));
    assert.throws(() => failure.code, error => error === inspection);
    allowClose = true; inspection.cacheOwnershipReleased = () => true;
    await rejected(() => getContainedFileSession(failure).releaseAfterClose()); assert.equal(closes, 1);
    inspectionSettled = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(closes, 2);
  }
  {
    let allowClose = false, closes = 0;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.close = async () => { closes += 1; if (!allowClose) return false; return close(); }; return handle;
    };
    const failure = await rejected(() => inspectReusableDictionary({ root, file, maxBytes: bytes.length, expectedHash }));
    assert.equal(closes, 1); assert.equal(getContainedFileSession(failure).isSettled(), false);
    allowClose = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(closes, 2);
    const reused = await inspectReusableDictionary({ root, file, maxBytes: bytes.length, expectedHash });
    assert.equal(reused.sha256, expectedHash);
  }
  fs.open = originalOpen;
  {
    let closes = 0, failed = false;
    const primary = Object.freeze(new Error('scheduler failed after actual native close fulfilled'));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.close = async () => { const value = await close(); closes += 1; return value; }; return handle;
    };
    const failure = await rejected(() => runWithSchedulerTaskLease({ suspendCpu: async action => {
      const result = await action(); if (closes && !failed) { failed = true; throw primary; } return result;
    } }, () => readVerifiedContainedFile(root, file)));
    assert.equal(failure, primary); assert.equal(closes, 1);
    assert.equal(getContainedFileSession(failure), null, 'confirmed close is retained even if the scheduler wrapper rejects afterward');
  }
  fs.open = originalOpen;
  {
    let settled = false, closes = 0, wrappers = 0;
    const primary = Object.freeze(Object.assign(new Error('scheduler wrapper failed after native open'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    }));
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), close = handle.close.bind(handle); disposal.push(close);
      handle.close = async () => { closes += 1; return close(); }; return handle;
    };
    const failure = await rejected(() => runWithSchedulerTaskLease({ suspendCpu: async action => {
      wrappers += 1; const result = await action(); if (wrappers === 1) throw primary; return result;
    } }, () => readVerifiedContainedFile(root, file)));
    assert.equal(contains(failure, primary), true); assert.equal(closes, 0);
    settled = true; await getContainedFileSession(failure).releaseAfterClose(); assert.equal(closes, 1);
  }
  fs.open = originalOpen;
  {
    let finishRead, announceRead, closes = 0, settled = false, borrowed;
    const reading = new Promise(resolve => { announceRead = resolve; });
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), read = handle.read.bind(handle), close = handle.close.bind(handle); disposal.push(close);
      handle.read = (...input) => new Promise(resolve => { finishRead = () => resolve(read(...input)); announceRead(); });
      handle.close = async () => { closes += 1; return close(); }; return handle;
    };
    const action = withContainedFile(root, file, descriptor => {
      borrowed = descriptor; descriptor.read(Buffer.alloc(bytes.length), 0, bytes.length, 0); return 'callback-result';
    }).then(value => { settled = true; return value; });
    await reading; assert.equal(closes, 0); assert.equal(settled, false);
    finishRead(); assert.equal(await action, 'callback-result'); assert.equal(closes, 1);
    await assert.rejects(borrowed.stat(), /no longer admits/);
    assert.throws(() => borrowed.verify(), /no longer admits/);
  }
  fs.open = originalOpen;
  assert.equal(getContainedFileSession({ containedFileSession: { releaseAfterClose() {}, isSettled: () => true } }), null);
  assert.deepEqual(await fs.readFile(file), bytes);
} finally {
  fs.open = originalOpen;
  for (const close of disposal) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('contained-file-resource-lifetime passed');
