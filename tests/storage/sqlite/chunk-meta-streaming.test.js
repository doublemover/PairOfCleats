#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import {
  loadDatabaseCtor,
  writeSqliteShardFixtureArtifacts
} from './helpers/build-fixture.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const Database = await loadDatabaseCtor();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-chunk-meta-streaming');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 5000;
const tokens = ['alpha', 'beta'];

const { shardResult, pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir,
  chunkCount,
  fileCount: 10,
  mode: 'code',
  tokens,
  chunkMaxBytes: 8192,
  tokenVocab: ['alpha']
});
if (shardResult.parts.length < 2) {
  console.error('Expected chunk_meta to be sharded for streaming test.');
  process.exit(1);
}
await writePiecesManifest(indexDir, pieceEntries);

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

