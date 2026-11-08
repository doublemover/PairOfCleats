import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const dir = await prepareArtifactIoTestDir('packed-postings-short-read');
const packedPath = path.join(dir, 'token_postings.packed.bin');
const postings = Array.from({ length: 12 }, (_, index) => [[index, 1], [index + 20, 2]]);
const packed = packTfPostings(postings, { blockSize: 2 });
await fsPromises.writeFile(packedPath, packed.buffer);
await fsPromises.writeFile(path.join(dir, 'token_postings.packed.offsets.bin'), encodePackedOffsets(packed.offsets));
await fsPromises.writeFile(path.join(dir, 'token_postings.packed.meta.json'), JSON.stringify({
  fields: { blockSize: packed.blockSize, offsets: 'token_postings.packed.offsets.bin' },
  arrays: { vocab: postings.map((_, index) => `term${index}`), docLengths: [] }
}));
await writePiecesManifest(dir, [
  { name: 'token_postings', path: 'token_postings.packed.bin', format: 'packed' },
  { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
]);
const originalRead = fs.readSync;
const originalOpen = fs.openSync;
const originalClose = fs.closeSync;
const originalReadFile = fs.readFileSync;
let packedFd = null;
let reads = 0;
let eof = false;
let eofReads = 0;
try {
  fs.openSync = (file, ...args) => {
    const fd = originalOpen(file, ...args);
    if (path.resolve(String(file)) === packedPath) packedFd = fd;
    return fd;
  };
  fs.closeSync = (fd) => {
    const result = originalClose(fd);
    if (fd === packedFd) packedFd = null;
    return result;
  };
  fs.readFileSync = (file, ...args) => {
    if (typeof file !== 'number' && path.resolve(String(file)) === packedPath) {
      assert.fail('packed data must never use a whole-file fallback');
    }
    return originalReadFile(file, ...args);
  };
  fs.readSync = (fd, buffer, offset, length, position) => {
    if (fd !== packedFd) return originalRead(fd, buffer, offset, length, position);
    reads += 1;
    assert.ok(length <= 1024, 'every requested window remains bounded');
    if (eof) { eofReads += 1; return 0; }
    return originalRead(fd, buffer, offset, Math.min(length, 3), position);
  };
  assert.deepEqual(loadTokenPostings(dir, { strict: false, packedWindowBytes: 1024,
    packedWindowTokens: 3 }).postings, postings);
  assert.ok(reads > 12, 'positive short reads are retried');
  assert.equal(packedFd, null, 'successful reads release the exact packed descriptor');
  eof = true;
  assert.throws(() => loadTokenPostings(dir, { strict: false }), { code: 'ERR_ARTIFACT_CORRUPT' });
  assert.equal(eofReads, 1, 'EOF is injected into the packed payload, never a reused metadata descriptor');
  assert.equal(packedFd, null, 'corrupt reads also release the exact packed descriptor');
} finally {
  fs.readSync = originalRead;
  fs.openSync = originalOpen;
  fs.closeSync = originalClose;
  fs.readFileSync = originalReadFile;
  await fsPromises.rm(dir, { recursive: true, force: true });
}
console.log('packed postings short read test passed');
