import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { decodePackedOffsets, encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual codec/manifest/window admission. UNVALIDATED: ordinary disposable
// files and inert read counters only, no native/database/benchmark execution.
const originalOpen = fs.openSync, originalRead = fs.readSync;
const root = await makeTempDir('poc-packed-offset-admission-');
const postings = [[[0, 1]], [[1, 1]], [[2, 1]]], packed = packTfPostings(postings);
const unsafeOffset = Buffer.alloc(8); unsafeOffset.writeBigUInt64LE(2n ** 53n);
assert.throws(() => decodePackedOffsets(Buffer.alloc(9)), { code: 'ERR_PACKED_OFFSETS' });
assert.throws(() => decodePackedOffsets(unsafeOffset), { code: 'ERR_PACKED_OFFSETS' });
assert.deepEqual(decodePackedOffsets(encodePackedOffsets([0, Number.MAX_SAFE_INTEGER])), [0, Number.MAX_SAFE_INTEGER]);
assert.deepEqual(decodePackedOffsets(Buffer.alloc(0)), [], 'standalone legacy empty offsets retain their contract');
try {
  let sequence = 0;
  const cases = [
    { offsets: Buffer.alloc(9), beforeOpen: true },
    { offsets: unsafeOffset, beforeOpen: true },
    { offsets: encodePackedOffsets([0, 3]), beforeOpen: true },
    { offsets: encodePackedOffsets(new Array(1024).fill(0)), beforeOpen: true },
    { offsets: encodePackedOffsets(packed.offsets), vocabIds: [1], beforeOpen: true },
    ...[[1, 3, 6, 9], [0, 3, 6, 8], [0, 3, 6, 10], [0, 6, 3, 9]]
      .map(offsets => ({ offsets: encodePackedOffsets(offsets), beforeOpen: false }))
  ];
  for (const invalid of [...cases, null]) {
    const dir = path.join(root, String(sequence++)); await fsp.mkdir(dir);
    const data = path.join(dir, 'token_postings.packed.bin');
    await fsp.writeFile(data, packed.buffer);
    await fsp.writeFile(path.join(dir, 'token_postings.packed.offsets.bin'), invalid?.offsets || encodePackedOffsets(packed.offsets));
    await fsp.writeFile(path.join(dir, 'token_postings.packed.meta.json'), JSON.stringify({
      fields: { blockSize: packed.blockSize, offsets: 'token_postings.packed.offsets.bin', totalDocs: 3, avgDocLen: 1 },
      arrays: { vocab: ['one', 'two', 'three'], docLengths: [1, 1, 1], ...(invalid?.vocabIds ? { vocabIds: invalid.vocabIds } : {}) }
    }));
    await writePiecesManifest(dir, [
      { name: 'token_postings', path: 'token_postings.packed.bin', format: 'packed' },
      { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
    ]);
    let packedFd, opens = 0, reads = 0;
    fs.openSync = (file, ...args) => {
      const fd = originalOpen(file, ...args);
      if (typeof file === 'string' && path.resolve(file) === data) { packedFd = fd; opens++; }
      return fd;
    };
    fs.readSync = (fd, ...args) => { if (fd === packedFd) reads++; return originalRead(fd, ...args); };
    try {
      if (invalid) {
        assert.throws(() => loadTokenPostings(dir, { strict: false }), error => ['ERR_PACKED_OFFSETS', 'ERR_ARTIFACT_INVALID'].includes(error.code));
        assert.equal(opens, invalid.beforeOpen ? 0 : 1);
        assert.equal(reads, 0, 'malformed sidecars cannot allocate/read a packed row window');
      } else {
        assert.deepEqual(loadTokenPostings(dir, { strict: false, packedWindowTokens: 1 }).postings, postings);
        assert.equal(opens, 1); assert.ok(reads > 0, 'unchanged complete sidecars still admit real bounded reads');
      }
    } finally { fs.openSync = originalOpen; fs.readSync = originalRead; }
    assert.deepEqual(await fsp.readFile(data), packed.buffer);
  }
} finally { fs.openSync = originalOpen; fs.readSync = originalRead; await rmDirRecursive(root); }
console.log('Packed offset and vocabulary admission controls authored; execution deferred.');
