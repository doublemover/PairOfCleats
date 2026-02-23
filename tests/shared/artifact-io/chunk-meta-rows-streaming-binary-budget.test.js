#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { loadChunkMeta, loadChunkMetaRows } from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

applyTestEnv();

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('chunk-meta-rows-streaming-binary-budget', { root });

const rows = [
  {
    id: 0,
    fileRef: 0,
    start: 0,
    end: 12,
    docmeta: {
      doc: `doc-a-${'x'.repeat(700)}`
    }
  },
  {
    id: 1,
    fileRef: 0,
    start: 12,
    end: 28,
    docmeta: {
      doc: `doc-b-${'y'.repeat(700)}`
    }
  }
];
const encoded = encodeBinaryRowFrames(rows.map((row) => Buffer.from(JSON.stringify(row), 'utf8')));

await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(
  path.join(testRoot, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: rows.length,
      data: 'chunk_meta.binary-columnar.bin',
      offsets: 'chunk_meta.binary-columnar.offsets.bin',
      lengths: 'chunk_meta.binary-columnar.lengths.varint'
    },
    arrays: {
      fileTable: ['src/streamed.js']
    }
  }, null, 2)
);
await fs.writeFile(
  path.join(testRoot, 'chunk_meta_cold.json'),
  JSON.stringify([
    { id: 0, preContext: 'pc0' },
    { id: 1, preContext: 'pc1' }
  ], null, 2)
);

await writePiecesManifest(testRoot, [
  { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'chunk_meta_binary_columnar_offsets', path: 'chunk_meta.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'chunk_meta_binary_columnar_lengths', path: 'chunk_meta.binary-columnar.lengths.varint', format: 'varint' },
  { name: 'chunk_meta_binary_columnar_meta', path: 'chunk_meta.binary-columnar.meta.json', format: 'json' },
  { name: 'chunk_meta_cold', path: 'chunk_meta_cold.json', format: 'json' }
]);

const streamed = [];
for await (const row of loadChunkMetaRows(testRoot, {
  strict: true,
  maxBytes: 1024
})) {
  streamed.push(row);
}
assert.equal(streamed.length, 2, 'expected streamed chunk_meta rows');
assert.equal(streamed[0]?.file, 'src/streamed.js', 'expected binary fileRef lookup');
assert.equal(streamed[0]?.preContext, 'pc0', 'expected cold row merge');
assert.equal(streamed[1]?.preContext, 'pc1', 'expected cold row merge');

const streamedHotOnly = [];
for await (const row of loadChunkMetaRows(testRoot, {
  strict: true,
  maxBytes: 1024,
  includeCold: false
})) {
  streamedHotOnly.push(row);
}
assert.equal(streamedHotOnly[0]?.preContext, undefined, 'expected includeCold=false to skip cold merge');

await assert.rejects(
  () => loadChunkMeta(testRoot, { strict: true, maxBytes: 1024 }),
  (err) => String(err?.message || '').toLowerCase().includes('exceeds maxbytes'),
  'materialized loadChunkMeta should enforce binary data budget'
);

console.log('chunk-meta rows streaming binary budget test passed');
