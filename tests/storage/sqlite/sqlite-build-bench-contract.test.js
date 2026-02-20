#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

try {
  await import('better-sqlite3');
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-bench-contract');
const indexDir = path.join(tempRoot, 'index-code');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 50;
const tokens = ['alpha', 'beta'];
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 3}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: `fn${i}`,
      tokens
    };
  }
};

const shardResult = await writeJsonLinesSharded({
  dir: indexDir,
  partsDirName: 'chunk_meta.parts',
  partPrefix: 'chunk_meta.part-',
  items: chunkIterator(),
  maxBytes: 4096,
  atomic: true
});
await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
  fields: {
    schemaVersion: '0.0.1',
    artifact: 'chunk_meta',
    format: 'jsonl-sharded',
    generatedAt: new Date().toISOString(),
    compression: 'none',
    totalRecords: shardResult.total,
    totalBytes: shardResult.totalBytes,
    maxPartRecords: shardResult.maxPartRecords,
    maxPartBytes: shardResult.maxPartBytes,
    targetMaxBytes: shardResult.targetMaxBytes,
    parts: shardResult.parts.map((part, index) => ({
      path: part,
      records: shardResult.counts[index] || 0,
      bytes: shardResult.bytes[index] || 0
    }))
  },
  atomic: true
});

const postingsDir = path.join(indexDir, 'token_postings.shards');
await fs.mkdir(postingsDir, { recursive: true });
const postingsPart = path.join(postingsDir, 'token_postings.part-00000.json');
const postingsEntries = Array.from({ length: chunkCount }, (_, i) => [i, 1]);
await writeJsonObjectFile(postingsPart, {
  arrays: {
    vocab: ['alpha'],
    postings: [postingsEntries]
  },
  atomic: true
});
const docLengths = Array.from({ length: chunkCount }, () => tokens.length);
await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
  fields: {
    avgDocLen: tokens.length,
    totalDocs: chunkCount,
    format: 'sharded',
    shardSize: 1,
    vocabCount: 1,
    parts: ['token_postings.shards/token_postings.part-00000.json']
  },
  arrays: { docLengths },
  atomic: true
});
await writePiecesManifest(indexDir, [
  ...shardResult.parts.map((part) => ({
    name: 'chunk_meta',
    path: part,
    format: 'jsonl'
  })),
  { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' },
  {
    name: 'token_postings',
    path: 'token_postings.shards/token_postings.part-00000.json',
    format: 'sharded'
  },
  { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
]);

const benchScript = path.join(root, 'tools', 'bench', 'sqlite', 'build-from-artifacts.js');
const result = spawnSync(process.execPath, [
  benchScript,
  '--mode',
  'current',
  '--index-dir',
  indexDir,
  '--statement-strategy',
  'prepared'
], { cwd: root, env: process.env, encoding: 'utf8' });

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.match(output, /\[bench\] build-from-artifacts current chunks=/, 'expected bench to report run');
assert.match(output, /\[bench\] current statementStrategy=/, 'expected bench to print strategy line');
assert.match(output, /\[bench\] current tables/, 'expected bench to print per-table stats');

console.log('sqlite build bench contract test passed');

