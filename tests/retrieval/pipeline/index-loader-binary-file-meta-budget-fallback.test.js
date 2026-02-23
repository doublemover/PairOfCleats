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

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-file-meta-binary-budget-'));
const indexDir = path.join(rootDir, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const chunkRows = [
  {
    id: 0,
    fileId: 0,
    file: null,
    start: 0,
    end: 42,
    lang: 'go',
    kind: 'FunctionDeclaration',
    name: 'alpha'
  }
];
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkRows));

const fileMetaRows = [
  {
    id: 0,
    file: 'src/alpha.go',
    ext: '.go',
    docmeta: {
      note: `large-${'x'.repeat(3000)}`
    }
  }
];

const encoded = encodeBinaryRowFrames(
  fileMetaRows.map((row) => Buffer.from(JSON.stringify(row), 'utf8'))
);
await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.bin'), encoded.dataBuffer);
await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
await fs.writeFile(path.join(indexDir, 'file_meta.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
await fs.writeFile(
  path.join(indexDir, 'file_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: fileMetaRows.length,
      data: 'file_meta.binary-columnar.bin',
      offsets: 'file_meta.binary-columnar.offsets.bin',
      lengths: 'file_meta.binary-columnar.lengths.varint'
    }
  }, null, 2)
);

await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'file_meta', path: 'file_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'file_meta_binary_columnar_offsets', path: 'file_meta.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'file_meta_binary_columnar_lengths', path: 'file_meta.binary-columnar.lengths.varint', format: 'varint' },
  { name: 'file_meta_binary_columnar_meta', path: 'file_meta.binary-columnar.meta.json', format: 'json' }
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
assert.equal(loaded.chunkMeta.length, 1, 'expected chunk metadata row to load');
assert.equal(loaded.chunkMeta[0]?.file, 'src/alpha.go', 'expected file to hydrate from binary file_meta');

console.log('index loader binary file_meta budget fallback test passed');
