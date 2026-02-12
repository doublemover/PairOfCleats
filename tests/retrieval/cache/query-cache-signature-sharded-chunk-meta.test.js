#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getIndexSignature } from '../../../src/retrieval/cli-index.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-meta-sig-'));
const codeDir = path.join(rootDir, 'index-code');
const partsDir = path.join(codeDir, 'chunk_meta.parts');
await fs.mkdir(partsDir, { recursive: true });

const partPath = path.join(partsDir, 'chunk_meta.part-0000.jsonl');
await fs.writeFile(partPath, JSON.stringify({ id: 0, file: 'src/a.js', start: 0, end: 1 }) + '\n');

const metaPath = path.join(codeDir, 'chunk_meta.meta.json');
const meta = {
  schemaVersion: '0.0.1',
  artifact: 'chunk_meta',
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: 'none',
  totalRecords: 1,
  totalBytes: 1,
  maxPartRecords: 1,
  maxPartBytes: 1,
  targetMaxBytes: 1,
  parts: [{ path: 'chunk_meta.parts/chunk_meta.part-0000.jsonl', records: 1, bytes: 1 }]
};
await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

const signature = await getIndexSignature({
  useSqlite: false,
  backendLabel: 'memory',
  sqliteCodePath: null,
  sqliteProsePath: null,
  runRecords: false,
  runExtractedProse: false,
  includeExtractedProse: false,
  root: rootDir,
  userConfig: {}
});

assert.equal(
  signature.modes?.code?.includes('chunk_meta.meta.json:'),
  true,
  'signature should include sharded chunk_meta metadata'
);
assert.equal(
  signature.modes?.code?.includes('|parts:'),
  true,
  'signature should include sharded chunk_meta part signatures'
);

console.log('query cache signature sharded chunk_meta test passed');
