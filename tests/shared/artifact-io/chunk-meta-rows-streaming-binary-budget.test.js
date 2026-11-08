#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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

const relaxed = await loadChunkMeta(testRoot, {
  strict: true,
  maxBytes: 1024,
  enforceBinaryDataBudget: false
});
assert.equal(relaxed.length, 2, 'expected relaxed binary budget mode to load chunk_meta rows');
assert.equal(relaxed[0]?.file, 'src/streamed.js', 'expected binary fileRef lookup in relaxed mode');

// Row admission remains binding when aggregate streaming admission is disabled.
// Sidecars fit every allowance here, so the negative belongs to the row owner.
const wide = { id: 0, fileRef: 0, docmeta: { doc: 'x'.repeat(8192) } };
const framed = encodeBinaryRowFrames([Buffer.from(JSON.stringify(wide))]);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.bin'), framed.dataBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.offsets.bin'), framed.offsetsBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.lengths.varint'), framed.lengthsBuffer);
const metaPath = path.join(testRoot, 'chunk_meta.binary-columnar.meta.json');
const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')); meta.fields.count = 1;
await fs.writeFile(metaPath, JSON.stringify(meta));
const read = fsSync.readSync;
let largestDataRead = 0;
try {
  fsSync.readSync = (fd, buffer, ...args) => {
    if (fsSync.fstatSync(fd).size === framed.dataBuffer.length) largestDataRead = Math.max(largestDataRead, buffer.length);
    return read.call(fsSync, fd, buffer, ...args);
  };
  for (const maxBytes of [framed.dataBuffer.length - 1, framed.dataBuffer.length, framed.dataBuffer.length + 1]) {
    const consume = async () => { const values = []; for await (const row of loadChunkMetaRows(testRoot,
      { strict: true, maxBytes, includeCold: false, enforceBinaryDataBudget: false })) values.push(row); return values; };
    if (maxBytes < framed.dataBuffer.length) {
      await assert.rejects(consume, { code: 'ERR_ARTIFACT_TOO_LARGE' });
      assert.equal(largestDataRead, 0, 'wide row rejected before its payload read');
    } else assert.equal((await consume())[0].docmeta.doc, wide.docmeta.doc);
  }
} finally { fsSync.readSync = read; }

console.log('chunk-meta rows streaming binary budget test passed');
