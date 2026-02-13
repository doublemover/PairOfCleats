#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getIndexSignature } from '../../src/retrieval/cli-index.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-shard-sig-'));
const codeDir = path.join(rootDir, 'index-code');
const partsDir = path.join(codeDir, 'chunk_meta.parts');
await fs.mkdir(partsDir, { recursive: true });

const partPath = path.join(partsDir, 'chunk_meta.part-0000.jsonl');
const metaPath = path.join(codeDir, 'chunk_meta.meta.json');
await fs.writeFile(partPath, '{"id":1,"file":"src/a.js","start":0,"end":1}\n', 'utf8');
await fs.writeFile(metaPath, JSON.stringify({
  artifact: 'chunk_meta',
  format: 'jsonl-sharded',
  parts: [
    { path: 'chunk_meta.parts/chunk_meta.part-0000.jsonl', records: 1, bytes: 48 }
  ]
}, null, 2), 'utf8');

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

await fs.writeFile(partPath, '{"id":1,"file":"src/a.js","start":0,"end":1}\n{"id":2,"file":"src/b.js","start":0,"end":1}\n', 'utf8');

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
  'index signature must change when chunk_meta shard content changes'
);

console.log('retrieval index signature shards unit test passed');
