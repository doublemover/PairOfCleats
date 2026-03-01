#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

applyTestEnv({
  extraEnv: {
    PAIROFCLEATS_TEST_MAX_JSON_BYTES: '1024'
  }
});

const { iterateChunkMetaSources, resolveChunkMetaSources } = await import('../../../src/storage/sqlite/build/from-artifacts/sources.js');

const root = process.cwd();
const testRoot = path.join(root, '.testLogs', 'sqlite-chunk-meta-binary-columnar-budget-hardening');
const indexDir = path.join(testRoot, 'index-code');

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const rows = [
  {
    id: 0,
    fileRef: 0,
    file: null,
    start: 0,
    end: 24,
    docmeta: { doc: `alpha-${'x'.repeat(700)}` }
  },
  {
    id: 1,
    fileRef: 0,
    file: null,
    start: 24,
    end: 64,
    docmeta: { doc: `beta-${'y'.repeat(700)}` }
  }
];
const encoded = encodeBinaryRowFrames(rows.map((row) => Buffer.from(JSON.stringify(row), 'utf8')));

await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(
  path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: rows.length,
      data: 'chunk_meta.binary-columnar.bin',
      offsets: 'chunk_meta.binary-columnar.offsets.bin',
      lengths: 'chunk_meta.binary-columnar.lengths.varint'
    },
    arrays: {
      fileTable: ['src/a.js']
    }
  }, null, 2)
);

await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'chunk_meta_binary_columnar_meta', path: 'chunk_meta.binary-columnar.meta.json', format: 'json' },
  { name: 'chunk_meta_binary_columnar_offsets', path: 'chunk_meta.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'chunk_meta_binary_columnar_lengths', path: 'chunk_meta.binary-columnar.lengths.varint', format: 'varint' }
]);

const sources = resolveChunkMetaSources(indexDir);
assert.equal(sources?.format, 'binary-columnar', 'expected chunk_meta source resolution to detect binary-columnar format');

await assert.rejects(
  () => iterateChunkMetaSources(sources, () => {}),
  (err) => String(err?.message || '').toLowerCase().includes('exceeds maxbytes'),
  'expected sqlite chunk_meta binary-columnar path to enforce maxBytes budget'
);

console.log('sqlite chunk_meta binary-columnar budget hardening test passed');
