#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runSqliteJsonlStreamingCompressionCase } from './helpers/jsonl-streaming-matrix.js';

const result = await runSqliteJsonlStreamingCompressionCase({
  compression: 'gzip',
  tempLabel: 'sqlite-jsonl-streaming-gzip'
});

if (!result.shardResult.parts.length || !result.shardResult.parts[0].endsWith(result.expectedPartExtension)) {
  console.error('Expected gzip-compressed chunk_meta parts.');
  process.exit(1);
}
assert.ok(result.indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');
assert.equal(result.count, result.chunkCount, 'expected sqlite build to ingest all chunks');
assert.equal(result.rowTotal, result.chunkCount, 'expected sqlite chunks table to match chunk_meta count');

if (!result.outPathExists) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite jsonl streaming gzip test passed');
