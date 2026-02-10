import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { loadMinhashSignatureRows } from '../../../src/shared/artifact-io/loaders.js';

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'minhash-packed-row-stability');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const dims = 6;
const count = 7;
const signatures = Array.from({ length: count }, (_, docId) => (
  Array.from({ length: dims }, (_, i) => (docId * 1000) + i + 1)
));

const packedPath = path.join(testRoot, 'minhash_signatures.packed.bin');
const packedMetaPath = path.join(testRoot, 'minhash_signatures.packed.meta.json');
const total = dims * count;
const packed = Buffer.allocUnsafe(total * 4);
const packedView = new Uint32Array(packed.buffer, packed.byteOffset, total);
let offset = 0;
for (const sig of signatures) {
  for (let i = 0; i < dims; i += 1) {
    packedView[offset] = sig[i];
    offset += 1;
  }
}

await fs.writeFile(packedPath, packed);
await writeJsonObjectFile(packedMetaPath, {
  fields: {
    format: 'u32',
    endian: 'le',
    dims,
    count
  },
  atomic: true
});

const rows = [];
for await (const row of loadMinhashSignatureRows(testRoot, {
  strict: false,
  batchSize: 2
})) {
  rows.push(row);
}

assert.equal(rows.length, count, 'expected one minhash row per doc');
for (let docId = 0; docId < count; docId += 1) {
  const row = rows[docId];
  assert.equal(row.docId, docId, `unexpected docId at row ${docId}`);
  assert.deepEqual(
    Array.from(row.sig),
    signatures[docId],
    `signature mutated after subsequent reads for doc ${docId}`
  );
}

console.log('minhash packed row stability test passed');
