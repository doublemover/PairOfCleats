#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
const tempRoot = path.join(root, '.testCache', 'sqlite-token-text-materialization-skip');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 12;
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
      tokens: []
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
await writeJsonObjectFile(path.join(postingsDir, 'token_postings.part-00000.json'), {
  arrays: {
    vocab: [],
    postings: []
  },
  atomic: true
});
await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
  fields: {
    avgDocLen: 0,
    totalDocs: chunkCount,
    format: 'sharded',
    shardSize: 1,
    vocabCount: 0,
    parts: ['token_postings.shards/token_postings.part-00000.json']
  },
  arrays: {
    docLengths: Array.from({ length: chunkCount }, () => 0)
  },
  atomic: true
});

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect sharded chunk_meta');
const sqliteStats = {};
const ingested = await buildDatabaseFromArtifacts({
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
  stats: sqliteStats
});

assert.equal(ingested, chunkCount, 'expected sqlite build to ingest all chunks');
assert.equal(sqliteStats.chunkMeta?.tokenTextMaterialized || 0, 0, 'expected zero token text materializations');
assert.equal(sqliteStats.chunkMeta?.tokenTextSkipped || 0, chunkCount, 'expected token text skips to match chunk count');

const db = new Database(outPath);
try {
  const ftsNullTokens = db.prepare('SELECT COUNT(*) AS total FROM chunks_fts WHERE tokens IS NULL').get();
  assert.equal(ftsNullTokens?.total, chunkCount, 'expected FTS token column to remain NULL for empty token arrays');
} finally {
  db.close();
}

console.log('sqlite token-text materialization skip test passed');
