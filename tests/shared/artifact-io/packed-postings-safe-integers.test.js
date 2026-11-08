import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { packTfPostings, encodePackedOffsets, unpackTfPostingSlice, unpackTfPostings }
  from '../../../src/shared/packed-postings.js';
import { writePackedTfPostings } from '../../../src/shared/packed-postings-write.js';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

// UNVALIDATED: unchanged wire-format oracle plus actual codec/streamed writer/
// bounded loader controls. No database, native binding or benchmark is invoked.
const integer = value => {
  let rest = BigInt(value); const bytes = [];
  do {
    const byte = Number(rest % 128n); rest /= 128n;
    bytes.push(rest ? byte + 128 : byte);
  } while (rest);
  return Buffer.from(bytes);
};
const row = (values, blockSize) => {
  const bytes = [integer(values.length)]; let previous = 0n;
  for (let index = 0; index < values.length; index++) {
    if (index % blockSize === 0) previous = 0n;
    const current = BigInt(values[index][0]);
    bytes.push(integer(current - previous), integer(values[index][1])); previous = current;
  }
  return Buffer.concat(bytes);
};
const postings = [[], [[0, 1], [1, 2]], [[2 ** 31, 2 ** 31], [2 ** 32 + 1, 2 ** 40],
  [2 ** 48, Number.MAX_SAFE_INTEGER], [Number.MAX_SAFE_INTEGER, 1]]];
for (const blockSize of [1, 2, 128]) {
  const encoded = packTfPostings(postings, { blockSize });
  assert.deepEqual(encoded.buffer, Buffer.concat(postings.map(values => row(values, blockSize))),
    'the existing encoder retains the independent BigInt wire representation');
  assert.deepEqual(unpackTfPostings(encoded.buffer, encoded.offsets, { blockSize }), postings,
    'block resets, signed-32-bit crossings and the entire safe integer domain roundtrip');
  for (let index = 0; index < postings.length; index++) {
    assert.deepEqual(unpackTfPostingSlice(encoded.buffer.subarray(encoded.offsets[index], encoded.offsets[index + 1]), { blockSize }), postings[index]);
  }
}
assert.deepEqual(unpackTfPostingSlice(Buffer.alloc(0)), [], 'preserve the existing empty slice contract');
for (const bytes of [
  Buffer.from([128]), Buffer.alloc(11, 128),
  integer(2n ** 53n),
  Buffer.concat([integer(1), integer(2n ** 53n), integer(1)]),
  Buffer.concat([integer(1), integer(0), integer(2n ** 53n)]),
  Buffer.concat([integer(Number.MAX_SAFE_INTEGER), Buffer.from([0, 1])]),
  Buffer.concat([integer(2), integer(Number.MAX_SAFE_INTEGER), integer(1), integer(1), integer(1)]),
  Buffer.from([1, 0]), Buffer.from([0, 0]), Buffer.from([1, 0, 1, 0])
]) assert.throws(() => unpackTfPostingSlice(bytes), { code: 'ERR_VARINT_DECODE' },
  'unsafe, impossible, truncated and trailing payloads fail before fabricated output/allocation');

const root = await prepareArtifactIoTestDir('packed-postings-safe-integers');
try {
  const supported = [[[0, 2 ** 31], [1, 2 ** 40]], [], [[1, Number.MAX_SAFE_INTEGER]]];
  const data = path.join(root, 'token_postings.packed.bin');
  const offsets = path.join(root, 'token_postings.packed.offsets.bin');
  const written = await writePackedTfPostings(data, offsets, supported, { blockSize: 2 });
  const packed = packTfPostings(supported, { blockSize: 2 });
  assert.deepEqual(await fs.readFile(data), Buffer.concat(supported.map(values => row(values, 2))));
  assert.deepEqual(await fs.readFile(offsets), encodePackedOffsets(packed.offsets));
  await fs.writeFile(path.join(root, 'token_postings.packed.meta.json'), JSON.stringify({
    fields: { blockSize: 2, offsets: path.basename(offsets), totalDocs: 2, avgDocLen: 1 },
    arrays: { vocab: ['wide', 'empty', 'largest'], docLengths: [1, 1] }
  }));
  await writePiecesManifest(root, [
    { name: 'token_postings', path: path.basename(data), format: 'packed', checksum: written.data.checksumHash },
    { name: 'token_postings_offsets', path: path.basename(offsets), format: 'binary', checksum: written.offsets.checksumHash },
    { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
  ]);
  const loaded = loadTokenPostings(root, { strict: false, packedWindowTokens: 1, packedWindowBytes: 1024 });
  assert.deepEqual(loaded.postings, supported, 'the actual bounded manifest loader retains wide term frequencies');
  assert.deepEqual(loaded.vocab, ['wide', 'empty', 'largest']);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Packed postings safe-integer and cardinality controls authored; execution deferred.');
