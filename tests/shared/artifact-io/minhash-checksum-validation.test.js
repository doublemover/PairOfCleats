import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import {
  loadMinhashSignatures,
  loadMinhashSignatureRows
} from '../../../src/shared/artifact-io/loaders.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = path.join(
  root,
  '.testLogs',
  'minhash-checksum-validation',
  `${process.pid}-${Date.now()}`
);
await fs.mkdir(path.join(testRoot, 'pieces'), { recursive: true });

const buildPackedFixture = async (dir, { tamper = false } = {}) => {
  await fs.mkdir(dir, { recursive: true });
  const dims = 4;
  const count = 5;
  const total = dims * count;
  const packed = Buffer.allocUnsafe(total * 4);
  const packedView = new Uint32Array(packed.buffer, packed.byteOffset, total);
  let offset = 0;
  for (let docId = 0; docId < count; docId += 1) {
    for (let i = 0; i < dims; i += 1) {
      packedView[offset] = (docId + 1) * 100 + i;
      offset += 1;
    }
  }
  const checksum = crypto.createHash('sha1').update(packed).digest('hex');
  if (tamper) {
    packed[0] ^= 0xff;
  }
  await fs.writeFile(path.join(dir, 'minhash_signatures.packed.bin'), packed);
  await writeJsonObjectFile(path.join(dir, 'minhash_signatures.packed.meta.json'), {
    fields: {
      format: 'u32',
      endian: 'le',
      dims,
      count,
      checksum: `sha1:${checksum}`
    },
    atomic: true
  });
  return { dims, count };
};

const validDir = path.join(testRoot, 'valid');
await fs.mkdir(path.join(validDir, 'pieces'), { recursive: true });
const { count } = await buildPackedFixture(validDir);
await writePiecesManifest(validDir, [
  { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
  { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
]);
const payload = await loadMinhashSignatures(validDir, { strict: false });
assert.ok(payload && Array.isArray(payload.signatures), 'expected packed minhash payload');
assert.equal(payload.signatures.length, count, 'expected one signature per row');

const corruptedDir = path.join(testRoot, 'corrupted');
await fs.mkdir(path.join(corruptedDir, 'pieces'), { recursive: true });
await buildPackedFixture(corruptedDir, { tamper: true });
await writePiecesManifest(corruptedDir, [
  { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
  { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
]);

await assert.rejects(
  () => loadMinhashSignatures(corruptedDir, { strict: false }),
  /checksum mismatch/i,
  'expected checksum mismatch for corrupted packed minhash data'
);

let streamErr = null;
try {
  for await (const _row of loadMinhashSignatureRows(corruptedDir, {
    strict: false,
    batchSize: 2
  })) {
    // consume rows until checksum verification runs
  }
} catch (err) {
  streamErr = err;
}
assert.ok(streamErr, 'expected streaming minhash loader to fail on checksum mismatch');
assert.match(String(streamErr?.message || ''), /checksum mismatch/i);

console.log('minhash checksum validation test passed');
