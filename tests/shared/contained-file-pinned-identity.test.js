import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile, readVerifiedContainedFileSync, openContainedFile, openContainedFileSync } from '../../src/shared/contained-file.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('contained-file-pinned-identity');
const file = path.join(dir, 'artifact.bin');
const body = Buffer.from([0, 1, 2, 128, 255]);
await fs.writeFile(file, body);
const stat = await fs.stat(file, { bigint: true });
const identity = { dev: stat.dev.toString(), ino: stat.ino.toString() };
const wrong = { ...identity, ino: (stat.ino + 1n).toString() };
const options = { maxBytes: body.length, expectedHash: createHash('sha256').update(body).digest('hex') };

// Matching bytes and ordinary stat fields cannot authorize a different object.
await assert.rejects(readVerifiedContainedFile(dir, file, { ...options, expectedFileIdentity: wrong }),
  { code: 'ERR_FILE_CHANGED' });
assert.throws(() => readVerifiedContainedFileSync(dir, file, { ...options, expectedFileIdentity: wrong }),
  { code: 'ERR_FILE_CHANGED' });
for (const read of [readVerifiedContainedFile, readVerifiedContainedFileSync]) {
  const result = await read(dir, file, options);
  assert.deepEqual(result.fileIdentity, identity, 'identity comes from the actual opened descriptor with exact integer values');
  assert.equal(JSON.stringify(result).includes('fileIdentity'), false, 'internal authority must not become serialized public output');
  const pinned = await read(dir, file, { ...options, expectedFileIdentity: identity });
  assert.deepEqual(pinned.buffer, body);
  assert.deepEqual(pinned.fileIdentity, identity);
}

const realOpen = fs.open, realReadSync = fsSync.readSync;
let reads = 0;
let opened = 0, closed = 0;
fs.open = async (...args) => {
  const handle = await realOpen(...args);
  if (args[0] === file) {
    opened++;
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    handle.read = (...input) => { reads++; return read(...input); };
    handle.close = async (...input) => { const result = await close(...input); closed++; return result; };
  }
  return handle;
};
fsSync.readSync = (...args) => { reads++; return realReadSync(...args); };
try {
  for (const expectedFileIdentity of [wrong, { ...identity, dev: (stat.dev + 1n).toString() }]) {
    await assert.rejects(readVerifiedContainedFile(dir, file, { ...options, expectedFileIdentity }), { code: 'ERR_FILE_CHANGED' });
    assert.throws(() => readVerifiedContainedFileSync(dir, file, { ...options, expectedFileIdentity }), { code: 'ERR_FILE_CHANGED' });
  }
  assert.equal(reads, 0, 'reject a different descriptor before reading any payload');
  assert.equal(opened, 2);
  assert.equal(closed, opened, 'rejected pins release every opened descriptor');
  for (const expectedFileIdentity of [[], true, '1:2', {}, { dev: Number(stat.dev), ino: Number(stat.ino) },
    { dev: identity.dev, ino: '-1' }, { ...identity, extra: 'untrusted' }]) {
    await assert.rejects(readVerifiedContainedFile(dir, file, { ...options, expectedFileIdentity }), TypeError);
    assert.throws(() => readVerifiedContainedFileSync(dir, file, { ...options, expectedFileIdentity }), TypeError);
    await assert.rejects(openContainedFile(dir, file, { expectedFileIdentity }), TypeError);
    assert.throws(() => openContainedFileSync(dir, file, { expectedFileIdentity }), TypeError);
  }
  assert.equal(reads, 0);
  assert.equal(closed, opened);
} finally {
  fs.open = realOpen; fsSync.readSync = realReadSync;
}

await fs.rename(file, path.join(dir, 'original.bin'));
await fs.writeFile(file, body);
const replacement = await fs.stat(file, { bigint: true });
assert.notEqual(replacement.ino.toString(), identity.ino, 'the replacement is a distinct actual filesystem object');
await assert.rejects(readVerifiedContainedFile(dir, file, { ...options, expectedFileIdentity: identity }), { code: 'ERR_FILE_CHANGED' });
assert.throws(() => readVerifiedContainedFileSync(dir, file, { ...options, expectedFileIdentity: identity }), { code: 'ERR_FILE_CHANGED' });
assert.deepEqual((await readVerifiedContainedFile(dir, file, options)).buffer, body, 'an explicit new read can pin the replacement');
console.log('Contained reads retain exact opened-file identities and reject stale pins before payload IO');
