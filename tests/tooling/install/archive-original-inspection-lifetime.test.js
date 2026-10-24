import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { extractArchive, getArchiveExtractionSession } from '../../../tools/shared/archive-extraction.js';
import { createArchiveResourceOwner, removeOwnedArchiveDirectory } from '../../../tools/shared/archive-resource-owner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: tiny actual Zip/Tar/Tar.gz consumers and exact FileHandle owners.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const root = await makeTempDir('poc-archive-original-inspection-');
const originalOpen = fs.open, disposal = new Map();
let sequence = 0;
try {
  const payload = Buffer.from('actual archive original observation control');
  const zip = new AdmZip(); zip.addFile('payload.txt', payload);
  const pack = tar.pack(); pack.entry({ name: 'payload.txt' }, payload); pack.finalize();
  const chunks = []; for await (const chunk of pack) chunks.push(chunk);
  const tarBytes = Buffer.concat(chunks);
  const archives = [['zip', zip.toBuffer()], ['tar', tarBytes], ['tar.gz', gzipSync(tarBytes)]];
  const install = decorate => {
    const states = [];
    fs.open = async (file, ...args) => {
      const actual = await originalOpen(file, ...args);
      const read = actual.read, write = actual.write, close = actual.close;
      const state = { file, actual, reads: 0, writes: 0, closes: 0 }; states.push(state);
      disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { assert.equal(this, actual); state.reads += 1; return read.call(actual, ...next); };
      actual.write = function (...next) { assert.equal(this, actual); state.writes += 1; return write.call(actual, ...next); };
      actual.close = function () {
        assert.equal(this, actual); state.closes += 1; disposal.delete(actual); return close.call(actual);
      };
      decorate?.(state); return actual;
    };
    return states;
  };

  for (const [type, bytes] of archives) {
    for (const marker of [undefined, false, true]) {
      const archive = path.join(root, `${sequence++}.${type}`), destination = path.join(root, `message-${sequence}`);
      await fs.writeFile(archive, bytes);
      let settled = false, messageReads = 0;
      const primary = Object.defineProperties(new Error(), {
        ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
        cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
        message: { get() { messageReads += 1; primary.cacheOwnershipReleased = () => true; return 'message replaced native observer'; } },
        code: { get() { assert.equal(this, primary); return 'EORIGINAL'; } }
      });
      const states = install(state => {
        if (state.file === archive) state.actual.read = function () { state.reads += 1; throw primary; };
      });
      const failure = await rejected(() => extractArchive(archive, destination, type));
      assert.equal(failure.cause, primary); assert.equal(failure.code, 'EORIGINAL');
      assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').set, undefined);
      assert.ok(messageReads >= 1); assert.ok(states.every(state => state.closes === 0));
      const session = getArchiveExtractionSession(failure);
      await rejected(() => session.releaseAfterClose());
      assert.ok(states.every(state => state.closes === 0));
      settled = true; const reads = states.reduce((sum, state) => sum + state.reads, 0);
      const receipt = await session.releaseAfterClose();
      assert.deepEqual(receipt, { resourceId: session.resourceId, settled: true, pending: false });
      assert.ok(states.every(state => state.closes === 1));
      assert.equal(states.reduce((sum, state) => sum + state.reads, 0), reads);
      await assert.rejects(fs.lstat(destination), { code: 'ENOENT' }); fs.open = originalOpen;
    }
  }

  for (const [type, bytes] of archives) {
    const archive = path.join(root, `${sequence++}.${type}`), destination = path.join(root, `observer-${sequence}`);
    await fs.writeFile(archive, bytes);
    let primarySettled = false, secondarySettled = false;
    const secondary = Object.assign(new Error('independent observer failure owns native work'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, secondary); return secondarySettled; }
    });
    const primary = Object.freeze(Object.assign(new Error('original native observer rejects'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, primary); if (!primarySettled) throw secondary; return true; }
    }));
    const states = install(state => { if (state.file === archive) state.actual.read = () => { state.reads += 1; throw primary; }; });
    const failure = await rejected(() => extractArchive(archive, destination, type));
    assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(secondary));
    assert.ok(states.every(state => state.closes === 0));
    primarySettled = true; secondary.cacheOwnershipReleased = () => true;
    const session = getArchiveExtractionSession(failure);
    await rejected(() => session.releaseAfterClose());
    assert.ok(states.every(state => state.closes === 0), 'a now-confirmed primary cannot erase the captured independent observer failure');
    secondarySettled = true; await session.releaseAfterClose();
    assert.ok(states.every(state => state.closes === 1)); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = originalOpen;
  }

  for (const [type, bytes] of archives) {
    for (const unconfirmed of [false, true, 0, null, 'closed', Object.freeze({ closed: true })]) {
      const archive = path.join(root, `${sequence++}.${type}`), destination = path.join(root, `nonvoid-${sequence}`);
      await fs.writeFile(archive, bytes);
      let deny = true;
      const states = install(state => {
        if (!state.file.startsWith(destination + path.sep)) return;
        const captured = state.actual.close;
        state.actual.close = function () {
          if (deny) { state.closes += 1; return Promise.resolve(unconfirmed); }
          return captured.call(state.actual);
        };
      });
      const failure = await rejected(() => extractArchive(archive, destination, type));
      const outputs = states.filter(state => state.file.startsWith(destination + path.sep));
      assert.equal(outputs.length, 1); assert.equal(outputs[0].closes, 1); assert.ok(outputs[0].actual.fd >= 0);
      assert.equal((await fs.lstat(destination)).isDirectory(), true);
      const reads = states.reduce((sum, state) => sum + state.reads, 0), writes = states.reduce((sum, state) => sum + state.writes, 0);
      const session = getArchiveExtractionSession(failure); deny = false;
      await session.releaseAfterClose();
      assert.equal(outputs[0].closes, 2); assert.equal(outputs[0].actual.fd, -1);
      assert.equal(states.reduce((sum, state) => sum + state.reads, 0), reads);
      assert.equal(states.reduce((sum, state) => sum + state.writes, 0), writes);
      assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
    }
  }

  // Exercise native owner projection itself without relying on a parser's own
  // formatting behavior for falsey message/Proxy traps.
  const direct = async () => {
    const destination = path.join(root, `direct-${sequence++}`), file = path.join(root, `input-${sequence}.bin`);
    await fs.mkdir(destination); const owned = await fs.lstat(destination, { bigint: true });
    await fs.writeFile(file, payload);
    const states = install();
    const owner = createArchiveResourceOwner(destination);
    owner.setCleanup(() => removeOwnedArchiveDirectory(destination, owned));
    await owner.open(file, 'r');
    return { owner, states, destination };
  };
  for (const inspection of [undefined, null, false, 0, '', Object.freeze(new Error('frozen message inspection rejected'))]) {
    const { owner, states } = await direct(); let reads = 0;
    const primary = Object.freeze(Object.defineProperty(new Error(), 'message', {
      get() { assert.equal(this, primary); reads += 1; throw inspection; }
    }));
    owner.record(primary);
    const failure = await rejected(() => owner.finish());
    assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(inspection));
    assert.equal(reads, 1); assert.ok(states.every(state => state.closes === 1));
    assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }
  {
    const { owner, states } = await direct(); let settled = false, inspections = 0;
    const target = Object.assign(new Error('capability inspection cannot replace original observer'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const primary = new Proxy(target, { getOwnPropertyDescriptor(object, field) {
      if (field === 'archiveExtractionSession') { inspections += 1; object.cacheOwnershipReleased = () => true; }
      return Reflect.getOwnPropertyDescriptor(object, field);
    } });
    owner.record(primary); const failure = await rejected(() => owner.finish());
    assert.equal(failure.cause, primary); assert.ok(inspections >= 1);
    assert.ok(states.every(state => state.closes === 0));
    await rejected(() => owner.session.releaseAfterClose()); assert.ok(states.every(state => state.closes === 0));
    settled = true; await owner.session.releaseAfterClose();
    assert.ok(states.every(state => state.closes === 1)); fs.open = originalOpen;
  }
  {
    const { owner, states } = await direct(); let settled = false, keys = 0;
    const inspection = Object.assign(new Error('original descriptor inspection owns native work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { return this === inspection && settled; }
    });
    const primary = new Proxy(Object.freeze(new Error('original proxy failure')), { ownKeys() { keys += 1; throw inspection; } });
    owner.record(primary);
    const failure = await rejected(() => owner.finish());
    assert.equal(failure.cause, primary); assert.ok(failure.errors.includes(inspection)); assert.equal(keys, 1);
    assert.ok(states.every(state => state.closes === 0));
    inspection.cacheOwnershipReleased = () => true;
    await rejected(() => owner.session.releaseAfterClose()); assert.equal(keys, 1);
    assert.ok(states.every(state => state.closes === 0));
    settled = true; await owner.session.releaseAfterClose();
    assert.ok(states.every(state => state.closes === 1)); assert.equal(keys, 1); fs.open = originalOpen;
  }
  {
    const { owner, states, destination } = await direct(); let settled = false, reads = 0;
    const inspection = Object.assign(new Error('late actual code inspection owns independent work'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { return this === inspection && settled; }
    });
    const primary = Object.freeze(Object.defineProperty(new Error('ordinary original read failure'), 'code', {
      get() { assert.equal(this, primary); reads += 1; throw inspection; }
    }));
    owner.record(primary);
    const failure = await rejected(() => owner.finish());
    assert.equal(reads, 0); assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
    assert.throws(() => failure.code, value => value === inspection);
    assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    inspection.cacheOwnershipReleased = () => true;
    const retained = await rejected(() => owner.session.releaseAfterClose());
    assert.ok(retained.errors.includes(inspection)); assert.ok(states.every(state => state.closes === 1));
    settled = true; const receipt = await owner.session.releaseAfterClose();
    assert.deepEqual(receipt, { resourceId: owner.session.resourceId, settled: true, pending: false });
    assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('archive-original-inspection-lifetime passed');
