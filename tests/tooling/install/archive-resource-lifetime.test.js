import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { extractArchive, getArchiveExtractionSession, isArchiveExtractionSession,
  runArchiveTransaction } from '../../../tools/shared/archive-extraction.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real tiny parser/FileHandle/transaction owners, injected boundary faults.
applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('archive-resource-lifetime');
const open = fs.open, rm = fs.rm, mkdir = fs.mkdir, lstat = fs.lstat;
const handles = [];
let sequence = 0;
const next = label => path.join(dir, `${sequence++}-${label}`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const receipt = (session, value) => assert.deepEqual(value, { resourceId: session.resourceId, settled: true, pending: false });
const wrapOpen = decorate => {
  fs.open = async (file, ...args) => {
    const handle = await open(file, ...args); handles.push(handle);
    const wrapper = {};
    for (const method of ['read', 'write', 'stat', 'close']) wrapper[method] = function (...values) {
      assert.equal(this, wrapper); return handle[method](...values);
    };
    decorate(file, wrapper, handle);
    return wrapper;
  };
};
const bytesFor = async payload => {
  const zip = new AdmZip(); zip.addFile('nested/payload.txt', payload);
  const pack = tar.pack(); pack.entry({ name: 'nested/payload.txt' }, payload); pack.finalize();
  const chunks = []; for await (const chunk of pack) chunks.push(chunk);
  const tarBytes = Buffer.concat(chunks);
  return [['zip', zip.toBuffer()], ['tar', tarBytes], ['tar.gz', gzipSync(tarBytes)]];
};
try {
  const archives = await bytesFor(Buffer.from('actual archive descriptor payload'));
  for (const [type, bytes] of archives) {
    const archive = next(`input.${type}`), destination = next('extracted');
    await fs.writeFile(archive, bytes);
    const writeCloseError = Object.freeze(Object.assign(new Error('frozen writer close'), { code: 'EIO' }));
    const readCloseError = Object.freeze(Object.assign(new Error('frozen source close'), { code: 'EACCES' }));
    const cleanupError = Object.freeze(new Error('exact destination removal denied'));
    let allowClose = false, allowRemove = false, inputCloses = 0, outputCloses = 0, removals = 0;
    const wrappers = [];
    wrapOpen((file, owned, handle) => {
      const source = file === archive;
      if (!source && !file.startsWith(destination + path.sep)) return;
      wrappers.push(owned);
      owned.close = async function () {
        assert.equal(this, owned);
        if (source) inputCloses += 1; else outputCloses += 1;
        if (!allowClose) throw source ? readCloseError : writeCloseError;
        await handle.close();
      };
    });
    fs.rm = async (file, options) => {
      if (file === destination) { removals += 1; if (!allowRemove) throw cleanupError; }
      return rm(file, options);
    };
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(failure.cause, writeCloseError);
    assert.ok(failure.errors.includes(readCloseError));
    assert.equal(inputCloses, 1); assert.equal(outputCloses, 1);
    assert.equal(removals, 0, 'no recursive removal before actual native close');
    const session = getArchiveExtractionSession(failure);
    assert.equal(isArchiveExtractionSession(session), true);
    assert.equal(isArchiveExtractionSession({ ...session }), false);
    assert.equal(Object.keys(failure).includes('archiveExtractionSession'), false);
    assert.equal(failure.cacheOwnershipReleased(), false);
    for (const wrapper of wrappers) Object.defineProperty(wrapper, 'close', { get() { assert.fail('must retain original native close'); } });
    allowClose = true;
    const failures = await Promise.all([rejected(() => session.releaseAfterClose()), rejected(() => session.releaseAfterClose())]);
    assert.equal(inputCloses, 2); assert.equal(outputCloses, 2); assert.equal(removals, 1);
    for (const latest of failures) {
      assert.equal(latest.cause, writeCloseError);
      assert.equal(latest.cleanupError, cleanupError);
      assert.equal(getArchiveExtractionSession(latest), session);
    }
    allowRemove = true;
    receipt(session, await session.releaseAfterClose());
    receipt(session, await session.releaseAfterClose());
    assert.equal(inputCloses, 2); assert.equal(outputCloses, 2); assert.equal(removals, 2);
    assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
    fs.open = open; fs.rm = rm;
  }

  // Successful EOF and protocol completion do not resolve extraction until the
  // captured real native output close fulfills.
  for (const [type, bytes] of archives) {
    const archive = next(`delayed.${type}`), destination = next('delayed-output');
    await fs.writeFile(archive, bytes);
    const entered = deferred(), gate = deferred(); let finished = false;
    wrapOpen((file, owned, handle) => {
      if (!file.startsWith(destination + path.sep)) return;
      owned.close = async () => { entered.resolve(); await gate.promise; await handle.close(); };
    });
    const extracting = extractArchive(archive, destination, type).finally(() => { finished = true; });
    await entered.promise;
    assert.equal(finished, false);
    gate.resolve();
    assert.equal(await extracting, true);
    assert.deepEqual(await fs.readFile(path.join(destination, 'nested/payload.txt')), Buffer.from('actual archive descriptor payload'));
    fs.open = open;
  }

  // Native read failure has an independent original observer even with a false
  // marker; exact close cannot clear it, nor can replacing its method.
  for (const [type, bytes] of archives) {
    const archive = next(`read.${type}`), destination = next('read-failure');
    await fs.writeFile(archive, bytes);
    let settled = false, reads = 0, closes = 0;
    const original = Object.assign(new Error('independent native read owner'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    wrapOpen((file, owned, handle) => {
      if (file !== archive) return;
      owned.read = () => { reads += 1; throw original; };
      owned.close = async () => { closes += 1; await handle.close(); };
    });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(failure.cause, original); assert.equal(closes, 0, 'rejected read promise is not native settlement');
    original.cacheOwnershipReleased = () => true;
    const session = getArchiveExtractionSession(failure);
    await rejected(() => session.releaseAfterClose());
    assert.equal(closes, 0, 'replacing the observer cannot permit actual descriptor destruction');
    assert.equal((await fs.lstat(destination)).isDirectory(), true);
    settled = true;
    receipt(session, await session.releaseAfterClose());
    assert.equal(closes, 1); assert.equal(reads, 1, 'reconciliation cannot replay extraction/read');
    fs.open = open;
  }

  // A rejected output operation can still own work on either admitted native
  // descriptor. Gate actual close, not just recursive cleanup.
  for (const [type, bytes] of archives) {
    const archive = next(`pending-write.${type}`), destination = next('pending-write');
    await fs.writeFile(archive, bytes);
    let settled = false, inputCloses = 0, outputCloses = 0, writes = 0;
    const original = Object.assign(new Error('original output native work'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    wrapOpen((file, owned, handle) => {
      if (file !== archive && !file.startsWith(destination + path.sep)) return;
      const input = file === archive;
      if (!input) owned.write = () => { writes += 1; throw original; };
      owned.close = async () => { if (input) inputCloses += 1; else outputCloses += 1; await handle.close(); };
    });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(failure.cause, original); assert.equal(writes, 1);
    assert.equal(inputCloses, 0); assert.equal(outputCloses, 0);
    original.cacheOwnershipReleased = () => true;
    const held = getArchiveExtractionSession(failure);
    await rejected(() => held.releaseAfterClose());
    assert.equal(inputCloses, 0); assert.equal(outputCloses, 0);
    settled = true; receipt(held, await held.releaseAfterClose());
    assert.equal(inputCloses, 1); assert.equal(outputCloses, 1); assert.equal(writes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = open;
  }

  // An exact self-produced outward error may be recaptured by its native close
  // hook without making isSettled a prerequisite for the close needed to settle
  // it. A lookalike pointing at that real session retains independent authority.
  {
    const [type, bytes] = archives[0];
    const archive = next(`self-observer.${type}`), destination = next('self-observer');
    await fs.writeFile(archive, bytes);
    let phase = 'initial', calls = 0, failure, held, independentSettled = false;
    const original = Object.freeze(new Error('original captured close failure'));
    let lookalike;
    wrapOpen((file, owned, handle) => { if (file === archive) owned.close = async () => {
      calls += 1;
      if (phase === 'initial') throw original;
      if (phase === 'self') throw failure;
      if (phase === 'lookalike') throw lookalike;
      await handle.close();
    }; });
    failure = await rejected(() => extractArchive(archive, destination, type));
    held = getArchiveExtractionSession(failure);
    phase = 'self'; await rejected(() => held.releaseAfterClose()); assert.equal(calls, 2);
    lookalike = Object.freeze(Object.assign(new Error('independent lookalike'), {
      archiveExtractionSession: held,
      cacheOwnershipReleased() { assert.equal(this, lookalike); return independentSettled; }
    }));
    phase = 'lookalike'; await rejected(() => held.releaseAfterClose()); assert.equal(calls, 3);
    phase = 'success'; await rejected(() => held.releaseAfterClose()); assert.equal(calls, 3);
    independentSettled = true; receipt(held, await held.releaseAfterClose()); assert.equal(calls, 4);
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = open;
  }

  for (const value of [undefined, null, false, 0, '']) {
    const [type, bytes] = archives[0];
    const archive = next(`falsey.${type}`), destination = next('falsey-write');
    await fs.writeFile(archive, bytes);
    wrapOpen((file, owned) => {
      if (file.startsWith(destination + path.sep)) owned.write = () => { throw value; };
    });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(Object.hasOwn(failure, 'cause'), true); assert.equal(failure.cause, value);
    assert.ok(failure.errors.includes(value));
    assert.equal(failure.cacheOwnershipReleased(), true, 'known closed descriptors permit original destination cleanup');
    await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
    fs.open = open;
  }

  // The Tar source can fail while its admitted mkdir task is still pending.
  // No owner may recursively remove the directory before that task returns.
  {
    const [, bytes] = (await bytesFor(Buffer.alloc(200 * 1024, 65)))[1];
    const archive = next('drain.tar'), destination = next('entry-drain');
    await fs.writeFile(archive, bytes);
    const entered = deferred(), gate = deferred(), readFailed = deferred();
    const events = []; let readCalls = 0, finished = false;
    const original = Object.freeze(new Error('source failed during entry task'));
    fs.mkdir = async (file, options) => {
      if (file === path.join(destination, 'nested')) { entered.resolve(); await gate.promise; events.push('mkdir-finished'); }
      return mkdir(file, options);
    };
    wrapOpen((file, owned, handle) => {
      if (file !== archive) return;
      owned.read = async (...args) => {
        readCalls += 1;
        if (readCalls === 1) return handle.read(...args);
        await entered.promise; events.push('read-failed'); readFailed.resolve(); throw original;
      };
    });
    fs.rm = async (file, options) => { if (file === destination) events.push('cleanup'); return rm(file, options); };
    const extracting = rejected(() => extractArchive(archive, destination, 'tar')).finally(() => { finished = true; });
    await readFailed.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false); assert.equal(events.includes('cleanup'), false);
    gate.resolve();
    const failure = await extracting;
    assert.equal(failure.cause, original);
    assert.ok(events.indexOf('cleanup') > events.indexOf('mkdir-finished'));
    fs.open = open; fs.mkdir = mkdir; fs.rm = rm;
  }

  // Exact cleanup failure values survive and permit a metadata-only retry.
  {
    const [type, bytes] = archives[0];
    const archive = next(`false-close.${type}`), destination = next('false-close');
    await fs.writeFile(archive, bytes);
    let allowed = false, calls = 0;
    wrapOpen((file, owned, handle) => { if (file === archive) owned.close = async () => {
      calls += 1; if (!allowed) return false; await handle.close();
    }; });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    allowed = true;
    const session = getArchiveExtractionSession(failure);
    receipt(session, await session.releaseAfterClose()); assert.equal(calls, 2);
    fs.open = open;
  }
  {
    const transaction = next('unknown-owner'); await fs.mkdir(transaction);
    const identity = await fs.lstat(transaction, { bigint: true });
    let fakeCalls = 0;
    const original = Object.freeze(Object.assign(new Error('unknown external owner'), {
      cacheOwnershipPending: true, archiveExtractionSession: { releaseAfterClose() { fakeCalls += 1; } }
    }));
    const failure = await rejected(() => runArchiveTransaction(transaction, identity, () => { throw original; }));
    const session = getArchiveExtractionSession(failure);
    await rejected(() => session.releaseAfterClose());
    assert.equal(fakeCalls, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await fs.lstat(transaction)).isDirectory(), true);
  }
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen cleanup'))]) {
    const archive = next('malformed.zip'), destination = next('cleanup-failure');
    await fs.writeFile(archive, 'invalid zip');
    let allowed = false;
    fs.rm = async (file, options) => { if (file === destination && !allowed) throw value; return rm(file, options); };
    const failure = await rejected(() => extractArchive(archive, destination, 'zip'));
    assert.equal(Object.hasOwn(failure, 'cleanupError'), true); assert.equal(failure.cleanupError, value);
    assert.ok(failure.errors.includes(value));
    allowed = true;
    const session = getArchiveExtractionSession(failure);
    receipt(session, await session.releaseAfterClose());
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.rm = rm;
  }

  // Frozen diagnostic getter failure carries its independent receiver-bound
  // owner; transaction cleanup cannot mistake diagnostic failure for settlement.
  {
    const transaction = next('message-transaction'); await fs.mkdir(transaction);
    const identity = await fs.lstat(transaction, { bigint: true });
    let settled = false, reads = 0;
    const secondary = Object.freeze(Object.assign(new Error('message inspection owner'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
    }));
    const original = Object.freeze(Object.defineProperty(new Error('replaced'), 'message', { get() { reads += 1; throw secondary; } }));
    const failure = await rejected(() => runArchiveTransaction(transaction, identity, () => { throw original; }));
    assert.equal(failure.cause, original); assert.ok(failure.errors.includes(secondary)); assert.equal(reads, 1);
    const session = getArchiveExtractionSession(failure);
    await rejected(() => session.releaseAfterClose());
    settled = true; receipt(session, await session.releaseAfterClose()); assert.equal(reads, 1);
  }
  {
    const [type, bytes] = archives[0];
    const archive = next(`nested.${type}`), transaction = next('nested-transaction');
    await fs.writeFile(archive, bytes); await fs.mkdir(transaction);
    const identity = await fs.lstat(transaction, { bigint: true }), destination = path.join(transaction, 'extracted');
    let allowed = false, calls = 0;
    wrapOpen((file, owned, handle) => { if (file === archive) owned.close = async () => {
      calls += 1; if (!allowed) throw new Error('real nested close remains pending'); await handle.close();
    }; });
    const failure = await rejected(() => runArchiveTransaction(transaction, identity, async () => {
      const inner = await rejected(() => extractArchive(archive, destination, type));
      // A genuine child capability remains authoritative even if an outer
      // adapter omitted its observer and supplied a false pending marker.
      throw Object.assign(new Error('outer context'), { cacheOwnershipPending: false,
        archiveExtractionSession: getArchiveExtractionSession(inner) });
    }));
    assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await fs.lstat(destination)).isDirectory(), true);
    allowed = true;
    const held = getArchiveExtractionSession(failure);
    receipt(held, await held.releaseAfterClose());
    assert.equal(calls, 2); assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(transaction), { code: 'ENOENT' });
    fs.open = open;
  }

  // Changed or never-sealed destination identity stays protected; an exact
  // owner may observe absence but cannot adopt a replacement directory.
  {
    const [type, bytes] = archives[0];
    const archive = next(`replacement.${type}`), destination = next('replacement'), retained = `${destination}-retained`;
    await fs.writeFile(archive, bytes);
    let allow = false;
    wrapOpen((file, owned, handle) => { if (file === archive) owned.close = async () => {
      if (!allow) throw new Error('source close held'); await handle.close();
    }; });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    await fs.rename(destination, retained); await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'marker'), 'replacement');
    allow = true;
    const session = getArchiveExtractionSession(failure);
    const latest = await rejected(() => session.releaseAfterClose());
    assert.equal(latest.cleanupError.code, 'ARCHIVE_UNSAFE');
    assert.equal(await fs.readFile(path.join(destination, 'marker'), 'utf8'), 'replacement');
    assert.equal((await fs.lstat(retained)).isDirectory(), true);
    await rm(destination, { recursive: true }); receipt(session, await session.releaseAfterClose());
    assert.equal((await fs.lstat(retained)).isDirectory(), true);
    fs.open = open;
  }
} finally {
  fs.open = open; fs.rm = rm; fs.mkdir = mkdir; fs.lstat = lstat;
  for (const handle of handles) { try { await handle.close(); } catch {} }
  await rm(dir, { recursive: true, force: true });
}
console.log('Archive descriptors, admitted entry tasks, and exact transaction cleanup retain original owners.');
