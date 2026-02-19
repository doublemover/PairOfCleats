import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { loadMinhashSignatures } from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const buildSignatures = (count, dims) => {
  const signatures = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const sig = new Array(dims);
    for (let j = 0; j < dims; j += 1) {
      sig[j] = (i + j) % 1024;
    }
    signatures[i] = sig;
  }
  return signatures;
};

const packSignatures = (signatures, dims) => {
  const total = signatures.length * dims;
  const buffer = Buffer.allocUnsafe(total * 4);
  const view = new Uint32Array(buffer.buffer, buffer.byteOffset, total);
  let offset = 0;
  for (const sig of signatures) {
    for (let i = 0; i < dims; i += 1) {
      view[offset] = Number.isFinite(sig[i]) ? sig[i] : 0;
      offset += 1;
    }
  }
  return buffer;
};

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('minhash-packed-roundtrip', { root });

const count = 12;
const dims = 8;
const signatures = buildSignatures(count, dims);

const packedPath = path.join(testRoot, 'minhash_signatures.packed.bin');
const packedMetaPath = path.join(testRoot, 'minhash_signatures.packed.meta.json');
await fs.writeFile(packedPath, packSignatures(signatures, dims));
await writeJsonObjectFile(packedMetaPath, {
  fields: {
    format: 'u32',
    endian: 'le',
    dims,
    count
  },
  atomic: true
});
await writePiecesManifest(testRoot, [
  { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
  { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
]);

const loaded = await loadMinhashSignatures(testRoot, { strict: false });
if (!loaded?.signatures || loaded.signatures.length !== signatures.length) {
  fail('Expected packed minhash signatures to load with the correct length.');
}

for (let i = 0; i < signatures.length; i += 1) {
  const expected = signatures[i];
  const actual = Array.from(loaded.signatures[i] || []);
  if (expected.length !== actual.length) {
    fail(`Packed minhash signature length mismatch at index ${i}.`);
  }
  for (let j = 0; j < expected.length; j += 1) {
    if (expected[j] !== actual[j]) {
      fail(`Packed minhash signature mismatch at index ${i}:${j}.`);
    }
  }
}

console.log('minhash packed roundtrip test passed');
