#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('binary-columnar-meta-path-traversal', { root });
const indexDir = path.join(testRoot, 'index');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const rows = [{ id: 1, file: 'src/a.js', ext: '.js' }];
const payloads = rows.map((entry) => Buffer.from(JSON.stringify(entry), 'utf8'));
const encoded = encodeBinaryRowFrames(payloads);

await fs.writeFile(path.join(indexDir, 'sample.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(indexDir, 'sample.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(indexDir, 'sample.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(path.join(testRoot, 'outside.bin'), encoded.dataBuffer);

await fs.writeFile(
  path.join(indexDir, 'sample.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: rows.length,
      data: '../outside.bin',
      offsets: 'sample.binary-columnar.offsets.bin',
      lengths: 'sample.binary-columnar.lengths.varint'
    }
  }, null, 2)
);

await writePiecesManifest(indexDir, [
  { name: 'sample', path: 'sample.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'sample_binary_columnar_offsets', path: 'sample.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'sample_binary_columnar_lengths', path: 'sample.binary-columnar.lengths.varint', format: 'varint' },
  { name: 'sample_binary_columnar_meta', path: 'sample.binary-columnar.meta.json', format: 'json' }
]);

await assert.rejects(
  () => loadJsonArrayArtifact(indexDir, 'sample', { strict: true }),
  (err) => err?.code === 'ERR_ARTIFACT_INVALID' && /Invalid binary-columnar data path/.test(String(err?.message || '')),
  'expected binary-columnar loader to reject traversal sidecar paths from meta'
);

console.log('binary-columnar meta path traversal test passed');
