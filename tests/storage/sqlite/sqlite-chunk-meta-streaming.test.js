#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-chunk-meta-streaming');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 5000;
const tokens = ['alpha', 'beta'];
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
      tokens
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
if (shardResult.parts.length < 2) {
  console.error('Expected chunk_meta to be sharded for streaming test.');
  process.exit(1);
}
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

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');
const sqliteStats = {};
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
  stats: sqliteStats
});
assert.equal(count, chunkCount, 'expected sqlite build to ingest all chunks');
assert.ok(sqliteStats.chunkMeta, 'expected sqlite stats to include chunkMeta metrics');
assert.equal(sqliteStats.chunkMeta.passes, 1, 'expected single consolidated chunk_meta ingest pass');
assert.equal(sqliteStats.chunkMeta.rows, chunkCount, 'expected chunkMeta rows metric to match ingested chunks');
assert.equal(
  sqliteStats.chunkMeta.streamedRows,
  chunkCount,
  'expected sharded/jsonl chunk_meta rows to be counted as streamed'
);
assert.equal(
  sqliteStats.chunkMeta.sourceRows?.jsonl,
  chunkCount,
  'expected sourceRows.jsonl to match chunk count'
);
assert.ok(
  Number(sqliteStats.chunkMeta.sourceFiles?.jsonl) >= 2,
  'expected sourceFiles.jsonl to include multiple shard files'
);
assert.equal(
  sqliteStats.chunkMeta.tokenTextMaterialized,
  chunkCount,
  'expected token text materialization count for populated token arrays'
);
assert.equal(
  sqliteStats.chunkMeta.tokenTextSkipped,
  0,
  'expected no token text skips when all chunks include tokens'
);

const db = new Database(outPath);
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
assert.equal(row?.total, chunkCount, 'expected sqlite chunks table to match chunk_meta count');
db.close();

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite chunk_meta streaming test passed');

