#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-dense-path-'));
const indexDir = path.join(rootDir, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([
  { id: 0, file: 'src/a.js', start: 0, end: 1, ext: '.js' }
], null, 2));

await fs.writeFile(path.join(rootDir, 'outside.bin'), Buffer.from([1, 2, 3, 4]));
await fs.writeFile(path.join(indexDir, 'dense_vectors_binary_meta.json'), JSON.stringify({
  path: '../outside.bin',
  dims: 2,
  count: 2
}, null, 2));

await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  pieces: [
    { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
    { name: 'dense_vectors_binary_meta', path: 'dense_vectors_binary_meta.json', format: 'json' }
  ]
}, null, 2));

const idx = await loadIndex(indexDir, {
  modelIdDefault: 'stub-model',
  strict: false,
  includeFilterIndex: false,
  includeTokenIndex: false,
  includeHnsw: false,
  includeMinhash: false,
  fileChargramN: 3
});

assert.equal(
  idx?.denseVec,
  null,
  'dense vector binary meta path should not allow traversal outside index directory'
);

console.log('index loader dense_vectors binary meta path traversal test passed');
