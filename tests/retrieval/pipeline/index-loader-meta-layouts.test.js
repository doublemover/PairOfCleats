#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { requireIndexDir } from '../../../src/retrieval/cli-index.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-layouts-'));

const columnarDir = path.join(rootDir, 'index-columnar');
await fs.mkdir(columnarDir, { recursive: true });
await fs.writeFile(path.join(columnarDir, 'chunk_meta.columnar.json.zst'), '{}', 'utf8');
assert.equal(hasIndexMeta(columnarDir), true, 'expected compressed columnar chunk_meta layout to be detected');

const binaryDir = path.join(rootDir, 'index-binary');
await fs.mkdir(binaryDir, { recursive: true });
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.meta.json'), JSON.stringify({
  format: 'binary-columnar-v1',
  count: 1,
  data: 'chunk_meta.binary-columnar.bin',
  offsets: 'chunk_meta.binary-columnar.offsets.bin',
  lengths: 'chunk_meta.binary-columnar.lengths.varint'
}, null, 2));
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.bin'), Buffer.from([1, 2, 3]));
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.lengths.varint'), Buffer.from([3]));
assert.equal(hasIndexMeta(binaryDir), true, 'expected binary-columnar chunk_meta layout to be detected');

const requiredBinaryDir = requireIndexDir(rootDir, 'code', {}, {
  resolveOptions: {
    indexDirByMode: { code: binaryDir },
    explicitRef: true
  },
  emitOutput: false,
  exitOnError: false
});
assert.equal(requiredBinaryDir, binaryDir, 'expected requireIndexDir to accept binary-columnar chunk_meta layouts');

const manifestDir = path.join(rootDir, 'index-manifest-only');
await fs.mkdir(path.join(manifestDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(manifestDir, 'custom'), { recursive: true });
await fs.writeFile(path.join(manifestDir, 'custom', 'chunk_meta.jsonl'), '{"id":1,"file":"src/a.js","start":0,"end":1}\n');
await fs.writeFile(path.join(manifestDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  pieces: [
    { name: 'chunk_meta', path: 'custom/chunk_meta.jsonl', format: 'jsonl' }
  ]
}, null, 2));
assert.equal(hasIndexMeta(manifestDir), true, 'expected manifest-declared chunk_meta layout to be detected');

const emptyDir = path.join(rootDir, 'index-empty');
await fs.mkdir(emptyDir, { recursive: true });
assert.equal(hasIndexMeta(emptyDir), false, 'expected empty index dir to report missing chunk_meta artifacts');
assert.throws(
  () => requireIndexDir(rootDir, 'code', {}, {
    resolveOptions: {
      indexDirByMode: { code: emptyDir },
      explicitRef: true
    },
    emitOutput: false,
    exitOnError: false
  }),
  (err) => err?.code === 'NO_INDEX',
  'expected requireIndexDir to reject empty explicit index dirs'
);

console.log('index loader meta layouts test passed');
