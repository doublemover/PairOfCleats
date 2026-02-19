import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('packed-postings-windowed-read', { root });

const vocab = ['alpha', 'beta', 'gamma', 'delta'];
const postings = [
  [[1, 2], [3, 1], [10, 4]],
  [[2, 1]],
  [],
  [[5, 2], [8, 3]]
];
const docLengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const packed = packTfPostings(postings, { blockSize: 2 });

await fs.writeFile(path.join(testRoot, 'token_postings.packed.bin'), packed.buffer);
await fs.writeFile(
  path.join(testRoot, 'token_postings.packed.offsets.bin'),
  encodePackedOffsets(packed.offsets)
);
await fs.writeFile(
  path.join(testRoot, 'token_postings.packed.meta.json'),
  JSON.stringify({
    fields: {
      blockSize: packed.blockSize,
      offsets: 'token_postings.packed.offsets.bin',
      totalDocs: docLengths.length,
      avgDocLen: 3
    },
    arrays: {
      vocab,
      docLengths
    }
  }, null, 2)
);
await writePiecesManifest(testRoot, [
  { name: 'token_postings', path: 'token_postings.packed.bin', format: 'packed' },
  { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
]);

const loaded = loadTokenPostings(testRoot, {
  strict: false,
  packedWindowTokens: 1,
  packedWindowBytes: 32
});

assert.deepEqual(loaded.vocab, vocab, 'expected packed vocab to roundtrip');
assert.deepEqual(loaded.docLengths, docLengths, 'expected packed docLengths to roundtrip');
assert.deepEqual(loaded.postings, postings, 'expected packed postings to roundtrip with windowed reads');

console.log('packed postings windowed read test passed');
