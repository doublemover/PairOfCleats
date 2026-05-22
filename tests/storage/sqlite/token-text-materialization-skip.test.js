#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
const tempRoot = resolveTestCachePath(root, 'sqlite-token-text-materialization-skip');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 12;
const { pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir,
  chunkCount,
  fileCount: 3,
  tokens: [],
  tokenVocab: [],
  tokenPostings: [],
  docLengths: Array.from({ length: chunkCount }, () => 0),
  avgDocLen: 0,
  tokenShardSize: 1
});
await writePiecesManifest(indexDir, pieceEntries);

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
