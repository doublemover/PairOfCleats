import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { planStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual Dir/preview/write-admission consumers, no child/process.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const root = await makeTempDir('poc-directory-close-evidence-');
const originalOpen = fs.opendir, disposal = new Map();
try {
  let sequence = 0;
  const install = (selected, unconfirmed) => {
    let deny = true, state;
    fs.opendir = async (file, ...args) => {
      const actual = await originalOpen(file, ...args); if (file !== selected) return actual;
      const read = actual.read, close = actual.close;
      state = { actual, reads: 0, closes: 0, replacements: 0 };
      disposal.set(actual, () => close.call(actual));
      actual.read = function () { assert.equal(this, actual); state.reads += 1; return read.call(actual); };
      actual.close = async function () {
        assert.equal(this, actual); state.closes += 1;
        if (deny) return unconfirmed;
        const result = await close.call(actual); disposal.delete(actual); return result;
      };
      return actual;
    };
    return { state: () => state, allow: () => { deny = false; } };
  };
  const recover = async (failure, installed) => {
    const session = getStorageDirectorySession(failure), state = installed.state();
    assert.ok(session); assert.equal(session.isSettled(), false); assert.equal(state.closes, 1);
    const reads = state.reads;
    state.actual.close = async () => { state.replacements += 1; };
    installed.allow();
    assert.deepEqual(await session.releaseAfterClose(), { resourceId: session.resourceId, settled: true, pending: false });
    assert.equal(state.closes, 2); assert.equal(state.replacements, 0); assert.equal(state.reads, reads);
    assert.equal(session.isSettled(), true);
    await session.releaseAfterClose(); assert.equal(state.closes, 2);
    return session;
  };
  for (const unconfirmed of [false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    const directory = path.join(root, `direct-${sequence++}`); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'entry.txt'), 'original');
    const installed = install(directory, unconfirmed);
    const failure = await rejected(() => withStorageDirectory(directory, reader => reader.read()));
    assert.equal(failure.cacheOwnershipPending, true);
    await recover(failure, installed); assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(await fs.readFile(path.join(directory, 'entry.txt'), 'utf8'), 'original');
    fs.opendir = originalOpen;
  }

  for (const unconfirmed of [false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    const home = path.join(root, `preview-${sequence++}`), target = path.join(root, `selected-${sequence}`);
    await fs.mkdir(path.join(home, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(home, 'config')); await fs.mkdir(target);
    const layout = resolveStorageLayout({ home, env: {} }), installed = install(target, unconfirmed);
    const preview = () => planStorageConfiguration({ layout, category: 'tmp', target });
    const failure = await rejected(preview);
    assert.equal(installed.state().closes, 1);
    await recover(failure, installed); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.opendir = originalOpen;
    assert.equal((await preview()).ready, true, 'ordinary void native close preserves the valid preview');
    assert.equal(readStorageLocator(home).status, 'missing');
    assert.deepEqual(await fs.readdir(target), []);
  }

  for (const unconfirmed of [false, true, 0, null, '', 'closed', Object.freeze({ closed: true })]) {
    const home = path.join(root, `admission-${sequence++}`), destination = path.join(home, 'assets');
    const coordinationRoot = path.join(home, 'state', 'storage-access'), inventory = path.join(coordinationRoot, 'write-reservations');
    const lock = path.join(coordinationRoot, 'write-admission.lock');
    await fs.mkdir(destination, { recursive: true }); await fs.mkdir(inventory, { recursive: true });
    let probes = 0;
    const input = { root: destination, coordinationRoot, authorizedRoots: [home], requiredBytes: 1,
      resourceId: `resource-${sequence}`, freeSpaceOwner: async () => {
        probes += 1; return { complete: true, availableBytes: 1024 * 1024, observedPath: destination };
      } };
    const installed = install(inventory, unconfirmed);
    const failure = await rejected(() => acquireStorageWriteReservation(input));
    assert.equal(probes, 0); assert.equal((await fs.lstat(lock)).isFile(), true);
    assert.deepEqual(await fs.readdir(inventory), []); assert.deepEqual(failure.storageWriteReservations, []);
    const admission = failure.storageAdmissionSession;
    await rejected(() => admission.releaseAfterSettlement({ resourceId: admission.resourceId, settled: true, pending: false }));
    assert.equal(installed.state().closes, 1);
    await recover(failure, installed);
    await admission.releaseAfterSettlement({ resourceId: admission.resourceId, settled: true, pending: false });
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(probes, 0);
    await assert.rejects(fs.lstat(lock), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(inventory), []);
    fs.opendir = originalOpen;
    const reservation = await acquireStorageWriteReservation(input);
    assert.equal(probes, 1); await reservation.releaseAfterSettlement({ resourceId: reservation.resourceId, settled: true, pending: false });
    assert.deepEqual(await fs.readdir(inventory), []);
  }
} finally {
  fs.opendir = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('directory-close-evidence-consumers passed');
