#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexSignature } from '../../src/retrieval/cli-index.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-token-binary-sig-'));
const codeDir = path.join(rootDir, 'index-code');
await fs.mkdir(codeDir, { recursive: true });
await fs.writeFile(path.join(codeDir, 'chunk_meta.json'), JSON.stringify([
  { id: 0, file: 'src/a.js', start: 0, end: 1 }
], null, 2));
await fs.writeFile(path.join(codeDir, 'token_postings.binary-columnar.meta.json'), JSON.stringify({
  format: 'binary-columnar-v1',
  count: 1,
  data: 'token_postings.binary-columnar.bin',
  offsets: 'token_postings.binary-columnar.offsets.bin',
  lengths: 'token_postings.binary-columnar.lengths.varint'
}, null, 2));
await fs.writeFile(path.join(codeDir, 'token_postings.binary-columnar.bin'), Buffer.from([1, 2, 3]));
await fs.writeFile(path.join(codeDir, 'token_postings.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
await fs.writeFile(path.join(codeDir, 'token_postings.binary-columnar.lengths.varint'), Buffer.from([3]));

const first = await getIndexSignature({
  useSqlite: false,
  backendLabel: 'memory',
  sqliteCodePath: null,
  sqliteProsePath: null,
  runRecords: false,
  runExtractedProse: false,
  includeExtractedProse: false,
  root: rootDir,
  userConfig: {},
  indexDirByMode: { code: codeDir },
  explicitRef: true
});
assert.equal(
  first.modes?.code?.includes('token_postings.binary-columnar.meta.json:'),
  true,
  'index signature should include binary-columnar token_postings artifacts'
);

await fs.writeFile(path.join(codeDir, 'token_postings.binary-columnar.bin'), Buffer.from([1, 2, 3, 4]));
const second = await getIndexSignature({
  useSqlite: false,
  backendLabel: 'memory',
  sqliteCodePath: null,
  sqliteProsePath: null,
  runRecords: false,
  runExtractedProse: false,
  includeExtractedProse: false,
  root: rootDir,
  userConfig: {},
  indexDirByMode: { code: codeDir },
  explicitRef: true
});
assert.notEqual(
  first.modes?.code,
  second.modes?.code,
  'index signature must change when binary-columnar token_postings payload changes'
);

console.log('retrieval index signature token binary-columnar unit test passed');
