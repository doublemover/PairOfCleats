#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getIndexSignature } from '../../src/retrieval/cli-index.js';

applyTestEnv();

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

const binaryDir = path.join(rootDir, 'index-binary');
await fs.mkdir(binaryDir, { recursive: true });
await fs.writeFile(
  path.join(binaryDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    format: 'binary-columnar-v1',
    count: 1,
    data: 'chunk_meta.binary-columnar.bin',
    offsets: 'chunk_meta.binary-columnar.offsets.bin',
    lengths: 'chunk_meta.binary-columnar.lengths.varint'
  }, null, 2),
  'utf8'
);
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.bin'), Buffer.from([1, 2, 3]));
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.lengths.varint'), Buffer.from([3]));

const binaryFirst = await getIndexSignature({
  useSqlite: false,
  backendLabel: 'memory',
  sqliteCodePath: null,
  sqliteProsePath: null,
  runRecords: false,
  runExtractedProse: false,
  includeExtractedProse: false,
  root: rootDir,
  userConfig: {},
  indexDirByMode: { code: binaryDir },
  explicitRef: true
});
assert.equal(
  binaryFirst.modes?.code?.includes('chunk_meta.binary-columnar.meta.json:'),
  true,
  'index signature should include binary-columnar chunk_meta artifacts'
);

await fs.writeFile(path.join(binaryDir, 'chunk_meta.binary-columnar.bin'), Buffer.from([1, 2, 3, 4]));

const binarySecond = await getIndexSignature({
  useSqlite: false,
  backendLabel: 'memory',
  sqliteCodePath: null,
  sqliteProsePath: null,
  runRecords: false,
  runExtractedProse: false,
  includeExtractedProse: false,
  root: rootDir,
  userConfig: {},
  indexDirByMode: { code: binaryDir },
  explicitRef: true
});
assert.notEqual(
  binaryFirst.modes?.code,
  binarySecond.modes?.code,
  'index signature must change when binary-columnar chunk_meta payload changes'
);

console.log('retrieval index signature shards unit test passed');
