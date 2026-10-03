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
const tempRoot = resolveTestCachePath(root, 'sqlite-build-memory-guard');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 1200;
const vocab = Array.from({ length: 600 }, (_, i) => `tok${i}`);
const postings = vocab.map(() => [[0, 1]]);
const docLengths = Array.from({ length: chunkCount }, () => 2);
const { pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir,
  chunkCount,
  fileCount: 10,
  tokens: ['alpha', 'beta'],
  tokenVocab: vocab,
  tokenPostings: postings,
  docLengths,
  avgDocLen: 2,
  tokenShardSize: vocab.length,
  chunkMaxBytes: 8192
});
await writePiecesManifest(indexDir, pieceEntries);

const indexPieces = await loadIndexPieces(indexDir, null);
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
