#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  loadDatabaseCtor,
  writeSqliteShardFixtureArtifacts
} from './helpers/build-fixture.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const Database = await loadDatabaseCtor();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-fts-contentless-schema');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 50;
const tokens = ['hello', 'world'];
const { pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir,
  chunkCount,
  fileCount: 3,
  mode: 'code',
  tokens,
  tokenVocab: ['hello'],
  decorateChunk: (_chunk, index) => ({
    docmeta: {
      signature: `sig:${index}`,
      doc: `hello world ${index}`
    }
  })
});
await writePiecesManifest(indexDir, pieceEntries);

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');

await buildDatabaseFromArtifacts({
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
  statementStrategy: 'prepared',
  optimize: false,
  buildPragmas: false
});

assert.ok(fsSync.existsSync(outPath), 'expected sqlite DB to be created');

const db = new Database(outPath);
const createRow = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
  .get();
assert.equal(typeof createRow?.sql, 'string', 'expected sqlite_master SQL for chunks_fts');
assert.match(createRow.sql, /content\s*=\s*''/i, 'expected chunks_fts to be contentless');
assert.match(createRow.sql, /contentless_delete\s*=\s*1/i, 'expected contentless_delete=1');

const matches = db.prepare('SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?').all('hello');
assert.ok(matches.length > 0, 'expected FTS MATCH to find inserted rows');

const probe = db.prepare('SELECT doc FROM chunks_fts WHERE rowid = ?').get(matches[0].rowid);
assert.equal(probe?.doc, null, 'expected contentless FTS doc column to return null');

// Verify incremental delete semantics are supported for contentless FTS.
db.prepare('DELETE FROM chunks_fts WHERE rowid = ?').run(matches[0].rowid);

db.close();

console.log('sqlite fts contentless schema test passed');

