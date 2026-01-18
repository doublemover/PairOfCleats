#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildChunkRow } from '../src/storage/sqlite/build-helpers.js';
import { CREATE_TABLES_BASE_SQL } from '../src/storage/sqlite/schema.js';

const chunk = {
  file: 'src/example.js',
  start: 0,
  end: 12,
  metaV2: { chunkId: 'chunk_sqlite_1' }
};
const row = buildChunkRow(chunk, 'code', 0);
assert.equal(row.chunk_id, 'chunk_sqlite_1', 'expected chunk_id in sqlite row');
assert.ok(CREATE_TABLES_BASE_SQL.includes('chunk_id'), 'expected chunk_id column in sqlite schema');

console.log('sqlite chunk id test passed');
