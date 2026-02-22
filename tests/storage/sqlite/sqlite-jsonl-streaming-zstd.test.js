#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { runSqliteJsonlStreamingCompressionCase } from './helpers/jsonl-streaming-matrix.js';

const result = await runSqliteJsonlStreamingCompressionCase({
  compression: 'zstd',
  tempLabel: 'sqlite-jsonl-streaming-zstd'
});

if (!result.shardResult.parts.length || !result.shardResult.parts[0].endsWith(result.expectedPartExtension)) {
  console.error('Expected zstd-compressed chunk_meta parts.');
  process.exit(1);
}
assert.ok(result.indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');
assert.equal(result.count, result.chunkCount, 'expected sqlite build to ingest all chunks');
assert.equal(result.rowTotal, result.chunkCount, 'expected sqlite chunks table to match chunk_meta count');

if (!result.outPathExists) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

const { default: Database } = await import('better-sqlite3');
const outPath = path.join(process.cwd(), '.testCache', 'sqlite-jsonl-streaming-zstd', 'index-code.db');
const db = new Database(outPath, { readonly: true, fileMustExist: true });
const chunksIndexRow = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chunks_file_id'"
).get();
const stageTableRow = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_stage'"
).get();
const stageIndexRow = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chunks_stage_file_id'"
).get();
db.close();

assert.ok(chunksIndexRow?.name === 'idx_chunks_file_id', 'expected final chunks index to exist');
assert.equal(stageTableRow ?? null, null, 'expected staged chunk table to be transient');
assert.equal(stageIndexRow ?? null, null, 'expected staged chunk index to be transient');

console.log('sqlite jsonl streaming zstd test passed');
