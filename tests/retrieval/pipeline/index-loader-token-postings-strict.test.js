#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-token-strict-'));
const indexDir = path.join(rootDir, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([
  { id: 0, file: 'src/a.js', start: 0, end: 1 }
], null, 2));
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  pieces: [
    { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }
  ]
}, null, 2));

await assert.rejects(
  () => loadIndex(indexDir, {
    modelIdDefault: 'stub-model',
    strict: true
  }),
  /token_postings/i,
  'strict index loading should fail when token_postings is missing from the manifest'
);

const nonStrict = await loadIndex(indexDir, {
  modelIdDefault: 'stub-model',
  strict: false
});
assert.equal(
  nonStrict?.tokenIndex,
  undefined,
  'non-strict index loading should skip token_postings when manifest entries are missing'
);

console.log('index loader token_postings strict wiring test passed');
