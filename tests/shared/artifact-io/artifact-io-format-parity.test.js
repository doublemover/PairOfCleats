#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { computePackedChecksum } from '../../../src/shared/artifact-io/checksum.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('artifact-io-format-parity', { root });

const rows = [
  { id: 0, file: 'src/a.js', ext: '.js', size: 12 },
  { id: 1, file: 'src/b.ts', ext: '.ts', size: 42 },
  { id: 2, file: 'README.md', ext: '.md', size: 7 }
];

const buildBinaryFixture = async (dir, values) => {
  await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
  const payloads = values.map((entry) => Buffer.from(JSON.stringify(entry), 'utf8'));
  const encoded = encodeBinaryRowFrames(payloads);
  const dataPath = path.join(dir, 'sample.binary-columnar.bin');
  const offsetsPath = path.join(dir, 'sample.binary-columnar.offsets.bin');
  const lengthsPath = path.join(dir, 'sample.binary-columnar.lengths.varint');
  const metaPath = path.join(dir, 'sample.binary-columnar.meta.json');
  await fs.writeFile(dataPath, encoded.dataBuffer);
  await fs.writeFile(offsetsPath, encoded.offsetsBuffer);
  await fs.writeFile(lengthsPath, encoded.lengthsBuffer);
  await fs.writeFile(metaPath, JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: values.length,
      data: 'sample.binary-columnar.bin',
      offsets: 'sample.binary-columnar.offsets.bin',
      lengths: 'sample.binary-columnar.lengths.varint'
    }
  }, null, 2));
  await writePiecesManifest(dir, [
    {
      name: 'sample',
      path: 'sample.binary-columnar.bin',
      format: 'binary-columnar',
      checksum: computePackedChecksum(encoded.dataBuffer, { algo: 'sha256' }).hash
    },
    {
      name: 'sample_binary_columnar_offsets',
      path: 'sample.binary-columnar.offsets.bin',
      format: 'binary',
      checksum: computePackedChecksum(encoded.offsetsBuffer, { algo: 'sha256' }).hash
    },
    {
      name: 'sample_binary_columnar_lengths',
      path: 'sample.binary-columnar.lengths.varint',
      format: 'varint',
      checksum: computePackedChecksum(encoded.lengthsBuffer, { algo: 'sha256' }).hash
    },
    {
      name: 'sample_binary_columnar_meta',
      path: 'sample.binary-columnar.meta.json',
      format: 'json'
    }
  ]);
};

const binaryDir = path.join(testRoot, 'binary');
await buildBinaryFixture(binaryDir, rows);
const materialized = await loadJsonArrayArtifact(binaryDir, 'sample', { strict: true });
assert.deepEqual(materialized, rows, 'binary-columnar materialized load should preserve rows');
const streamed = [];
for await (const row of loadJsonArrayArtifactRows(binaryDir, 'sample', { strict: true })) {
  streamed.push(row);
}
assert.deepEqual(streamed, rows, 'binary-columnar streaming load should preserve rows');

const corruptDir = path.join(testRoot, 'corrupt');
await buildBinaryFixture(corruptDir, rows);
await fs.writeFile(path.join(corruptDir, 'sample.binary-columnar.bin'), Buffer.from('not-json\n', 'utf8'));
await assert.rejects(
  () => loadJsonArrayArtifact(corruptDir, 'sample', { strict: true }),
  (err) => err?.code === 'ERR_ARTIFACT_CORRUPT',
  'checksum mismatch or invalid row payload should fail closed'
);

console.log('artifact io format parity test passed');
