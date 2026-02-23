#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

applyTestEnv({
  extraEnv: {
    PAIROFCLEATS_TEST_MAX_JSON_BYTES: '1024'
  }
});

const { loadIndex } = await import('../../../src/retrieval/cli-index.js');

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-binary-budget-'));
const indexDir = path.join(rootDir, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const chunkRows = [
  {
    id: 0,
    fileRef: 0,
    file: null,
    start: 0,
    end: 100,
    lang: 'javascript',
    kind: 'FunctionDeclaration',
    name: 'alpha',
    docmeta: { doc: `alpha-${'x'.repeat(500)}` }
  },
  {
    id: 1,
    fileRef: 1,
    file: null,
    start: 100,
    end: 240,
    lang: 'javascript',
    kind: 'FunctionDeclaration',
    name: 'beta',
    docmeta: { doc: `beta-${'y'.repeat(500)}` }
  }
];

const encoded = encodeBinaryRowFrames(
  chunkRows.map((row) => Buffer.from(JSON.stringify(row), 'utf8'))
);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(indexDir, 'chunk_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(
  path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: chunkRows.length,
      data: 'chunk_meta.binary-columnar.bin',
      offsets: 'chunk_meta.binary-columnar.offsets.bin',
      lengths: 'chunk_meta.binary-columnar.lengths.varint'
    },
    arrays: {
      fileTable: ['src/alpha.js', 'src/beta.js']
    }
  }, null, 2)
);

await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'chunk_meta_binary_columnar_offsets', path: 'chunk_meta.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'chunk_meta_binary_columnar_lengths', path: 'chunk_meta.binary-columnar.lengths.varint', format: 'varint' },
  { name: 'chunk_meta_binary_columnar_meta', path: 'chunk_meta.binary-columnar.meta.json', format: 'json' }
]);

const loaded = await loadIndex(indexDir, {
  modelIdDefault: 'stub-model',
  strict: true,
  includeTokenIndex: false,
  includeFilterIndex: false,
  includeDense: false,
  includeMinhash: false,
  includeFileRelations: false,
  includeRepoMap: false,
  includeChunkMetaCold: false
});

assert.ok(Array.isArray(loaded?.chunkMeta), 'expected chunk metadata array');
assert.equal(loaded.chunkMeta.length, chunkRows.length, 'expected all chunk rows to load');
assert.equal(loaded.chunkMeta[0]?.file, 'src/alpha.js', 'expected binary fileRef lookup for row 0');
assert.equal(loaded.chunkMeta[1]?.file, 'src/beta.js', 'expected binary fileRef lookup for row 1');

console.log('index loader binary chunk_meta budget fallback test passed');
