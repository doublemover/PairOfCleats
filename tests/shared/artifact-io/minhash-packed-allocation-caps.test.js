import assert from 'node:assert/strict';
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
  'minhash-packed-allocation-caps',
  `${process.pid}-${Date.now()}`
);

const createPackedFixture = async (dir, {
  dims,
  count,
  byteLength = null
}) => {
  await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
  const resolvedByteLength = byteLength == null
    ? (dims * count * 4)
    : Math.max(0, Math.floor(Number(byteLength)));
  const packedPath = path.join(dir, 'minhash_signatures.packed.bin');
  const packedMetaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
  const packed = Buffer.alloc(resolvedByteLength, 0);
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
  await writePiecesManifest(dir, [
    { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
    { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
  ]);
  return { packedPath, packedMetaPath };
};

await fs.mkdir(path.join(testRoot, 'pieces'), { recursive: true });

const invalidDimsDir = path.join(testRoot, 'invalid-dims');
await createPackedFixture(invalidDimsDir, {
  dims: 3.5,
  count: 1,
  byteLength: 4
});
await assert.rejects(
  () => loadMinhashSignatures(invalidDimsDir, { strict: false }),
  (err) => err?.code === 'ERR_ARTIFACT_INVALID'
    && /Invalid packed minhash dims/i.test(String(err?.message || '')),
  'expected strict integer validation for packed minhash dims'
);

const overBudgetDir = path.join(testRoot, 'over-budget');
await createPackedFixture(overBudgetDir, {
  dims: 32,
  count: 64
});
await assert.rejects(
  () => loadMinhashSignatures(overBudgetDir, { strict: false, maxBytes: 2048 }),
  (err) => err?.code === 'ERR_ARTIFACT_TOO_LARGE'
    && /exceeds maxBytes/i.test(String(err?.message || '')),
  'expected maxBytes guard before full packed allocation'
);

const streamBudgetDir = path.join(testRoot, 'stream-row-budget');
await createPackedFixture(streamBudgetDir, {
  dims: 20 * 1024 * 1024,
  count: 1,
  byteLength: 4
});
await assert.rejects(
  async () => {
    for await (const _row of loadMinhashSignatureRows(streamBudgetDir, {
      strict: false,
      maxBytes: 512 * 1024 * 1024,
      batchSize: 1
    })) {
      // no-op
    }
  },
  (err) => err?.code === 'ERR_ARTIFACT_TOO_LARGE'
    && /stream buffer budget/i.test(String(err?.message || '')),
  'expected stream row-size budget guard before batch allocation'
);

const cappedBatchDir = path.join(testRoot, 'capped-batch-size');
await createPackedFixture(cappedBatchDir, {
  dims: 8,
  count: 128
});
let rowCount = 0;
for await (const row of loadMinhashSignatureRows(cappedBatchDir, {
  strict: false,
  maxBytes: 4096,
  batchSize: Number.MAX_SAFE_INTEGER
})) {
  assert.ok(row?.sig instanceof Uint32Array, 'expected packed rows to decode to Uint32Array');
  rowCount += 1;
}
assert.equal(rowCount, 128, 'expected rows to stream successfully with bounded batch allocation');

console.log('minhash packed allocation caps test passed');
