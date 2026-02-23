#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('chunk-meta-binary-columnar-path-traversal', { root });
const indexDir = path.join(testRoot, 'index');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const rows = [{ id: 0, file: 'src/a.js' }];
const encoded = encodeBinaryRowFrames(rows.map((entry) => Buffer.from(JSON.stringify(entry), 'utf8')));
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(path.join(testRoot, 'outside.bin'), encoded.dataBuffer);
await fs.writeFile(
  path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: rows.length,
      data: '../outside.bin',
      offsets: 'chunk_meta.binary-columnar.offsets.bin',
      lengths: 'chunk_meta.binary-columnar.lengths.varint'
    }
  }, null, 2)
);
await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'chunk_meta_binary_columnar_meta', path: 'chunk_meta.binary-columnar.meta.json', format: 'json' },
  { name: 'chunk_meta_binary_columnar_offsets', path: 'chunk_meta.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'chunk_meta_binary_columnar_lengths', path: 'chunk_meta.binary-columnar.lengths.varint', format: 'varint' }
]);

await assert.rejects(
  () => loadChunkMeta(indexDir, { strict: true, preferBinaryColumnar: true }),
  /Invalid chunk_meta binary-columnar data path/,
  'expected chunk_meta binary-columnar loader to reject traversal sidecar paths'
);

console.log('chunk meta binary-columnar path traversal test passed');
