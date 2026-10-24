import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { acquireStorageWriteReservation } from '../../../src/shared/storage/admission.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Authored from the real Windows installer admission failure; execution deferred.
// Only native identity observations are controlled; real reservation/coordinator,
// descriptor reads, original close, JSON bytes and exact removal owners execute.
const root = await makeTempDir('poc-reservation-exact-id-');
const open = fsp.open, lstat = fsp.lstat, statSync = fs.statSync, fstatSync = fs.fstatSync, unlink = fsp.unlink;
const descriptors = new Map(), identities = new Map();
const base = 2n ** 60n, originalId = base + 1n, replacementId = base + 2n;
assert.equal(Number(originalId), Number(replacementId), 'distinct native IDs share one rounded double');
assert.notEqual(String(originalId), String(Number(originalId)));
const record = name => typeof name === 'string' && path.basename(path.dirname(name)) === 'write-reservations'
  && /^[a-f0-9-]{36}\.json$/u.test(path.basename(name));
const identity = name => identities.get(name) ?? originalId;
const project = (stat, name) => {
  stat.ino = typeof stat.ino === 'bigint' ? identity(name) : Number(identity(name)); return stat;
};
fsp.open = async (name, ...args) => {
  const actual = await open(name, ...args); if (!record(name)) return actual;
  const stat = actual.stat, close = actual.close; descriptors.set(actual.fd, name);
  actual.stat = async function (...next) { assert.equal(this, actual); return project(await stat.call(actual, ...next), name); };
  actual.close = async function () {
    assert.equal(this, actual); const fd = actual.fd, result = await close.call(actual); descriptors.delete(fd); return result;
  };
  return actual;
};
fsp.lstat = async (name, ...args) => {
  const stat = await lstat(name, ...args); return record(name) ? project(stat, name) : stat;
};
fs.statSync = (name, ...args) => {
  const stat = statSync(name, ...args); return record(name) ? project(stat, name) : stat;
};
fs.fstatSync = (fd, ...args) => {
  const stat = fstatSync(fd, ...args), name = descriptors.get(fd); return name ? project(stat, name) : stat;
};
const create = async scope => {
  const home = path.join(root, scope), destination = path.join(home, 'assets'), coordinationRoot = path.join(home, 'state', 'storage-access');
  await fsp.mkdir(destination, { recursive: true }); let probes = 0;
  const reservation = await acquireStorageWriteReservation({ root: destination, coordinationRoot, authorizedRoots: [home],
    resourceId: scope, requiredBytes: 1, freeSpaceOwner: async () => {
      probes += 1; return { complete: true, availableBytes: 1024 * 1024, observedPath: destination };
    } });
  return { reservation, file: path.join(coordinationRoot, 'write-reservations', reservation.reservationId + '.json'),
    lock: path.join(coordinationRoot, 'write-admission.lock'), receipt: { resourceId: scope, settled: true, pending: false }, probes: () => probes };
};
try {
  const entry = await create('exact-large-identity'); let unlinks = 0;
  fsp.unlink = async (name, ...args) => { if (name === entry.file) unlinks += 1; return unlink(name, ...args); };
  assert.equal((await fsp.stat(entry.file)).isFile(), true);
  assert.equal(String((await fsp.lstat(entry.file, { bigint: true })).ino), String(originalId));
  assert.equal(await entry.reservation.releaseAfterSettlement(entry.receipt), true);
  assert.equal(unlinks, 1); assert.equal(entry.probes(), 1);
  assert.equal(await entry.reservation.releaseAfterSettlement(entry.receipt), true); assert.equal(unlinks, 1);
  await assert.rejects(lstat(entry.file), { code: 'ENOENT' }); await assert.rejects(lstat(entry.lock), { code: 'ENOENT' });
  fsp.unlink = unlink;

  const replaced = await create('same-rounded-replacement'), originalBytes = await fsp.readFile(replaced.file);
  const saved = path.join(root, 'preserved-original.json'); await fsp.rename(replaced.file, saved);
  await fsp.writeFile(replaced.file, originalBytes, { flag: 'wx' }); identities.set(replaced.file, replacementId);
  let removed = 0;
  fsp.unlink = async (name, ...args) => { if (name === replaced.file) removed += 1; return unlink(name, ...args); };
  await assert.rejects(replaced.reservation.releaseAfterSettlement(replaced.receipt), error =>
    error.reason === 'write-reservation-file-changed' && error.cacheOwnershipPending === true);
  assert.equal(removed, 0, 'matching bytes/rounded inode do not authorize unlink of a replaced object');
  assert.deepEqual(await fsp.readFile(replaced.file), originalBytes); assert.deepEqual(await fsp.readFile(saved), originalBytes);
  fsp.unlink = unlink;
  // Only this fixture restores its exact original object; recovery does not
  // discover the renamed record or adopt the replacement's same logical ID.
  await fsp.unlink(replaced.file); await fsp.rename(saved, replaced.file); identities.delete(replaced.file);
  assert.equal(await replaced.reservation.releaseAfterSettlement(replaced.receipt), true);
  assert.equal(replaced.probes(), 1); await assert.rejects(lstat(replaced.lock), { code: 'ENOENT' });
} finally {
  fsp.open = open; fsp.lstat = lstat; fsp.unlink = unlink; fs.statSync = statSync; fs.fstatSync = fstatSync;
  await rmDirRecursive(root);
}
