#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-memory-guard');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 1200;
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 10}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: `fn${i}`,
      tokens: ['alpha', 'beta']
    };
  }
};

const shardResult = await writeJsonLinesSharded({
  dir: indexDir,
  partsDirName: 'chunk_meta.parts',
  partPrefix: 'chunk_meta.part-',
  items: chunkIterator(),
  maxBytes: 8192,
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
const vocab = Array.from({ length: 600 }, (_, i) => `tok${i}`);
const postings = vocab.map(() => [[0, 1]]);
await writeJsonObjectFile(path.join(postingsDir, 'token_postings.part-00000.json'), {
  arrays: { vocab, postings },
  atomic: true
});
const docLengths = Array.from({ length: chunkCount }, () => 2);
await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
  fields: {
    avgDocLen: 2,
    totalDocs: chunkCount,
    format: 'sharded',
    shardSize: vocab.length,
    vocabCount: vocab.length,
    parts: ['token_postings.shards/token_postings.part-00000.json']
  },
  arrays: { docLengths },
  atomic: true
});

const indexPieces = loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');
const stats = {};
const count = await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  batchSize: 200,
  stats
});

assert.equal(count, chunkCount, 'expected sqlite build to ingest all chunks');
assert.ok(stats.chunkMetaBatches > 1, 'expected chunk meta batches to flush');
assert.ok(stats.tokenPostingBatches > 1, 'expected token postings to flush in batches');
assert.ok(stats.tokenVocabBatches > 1, 'expected token vocab batches to flush');
assert.ok(stats.docLengthBatches > 1, 'expected doc length batches to flush');

const db = new Database(outPath);
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
assert.equal(row?.total, chunkCount, 'expected sqlite chunks table to match chunk_meta count');
db.close();

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite build memory guard test passed');
