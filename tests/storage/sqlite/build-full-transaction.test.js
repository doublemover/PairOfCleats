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
const tempRoot = resolveTestCachePath(root, 'sqlite-build-full-transaction');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 2000;
const tokens = ['alpha', 'beta'];
const { pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir,
  chunkCount,
  fileCount: 5,
  tokens,
  tokenVocab: ['alpha'],
  chunkMaxBytes: 8192
});
await writePiecesManifest(indexDir, pieceEntries);

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');

const execCalls = [];
class InstrumentedDatabase extends Database {
  exec(sql) {
    execCalls.push(String(sql || '').trim());
    return super.exec(sql);
  }
}

const stats = {};
const count = await buildDatabaseFromArtifacts({
  Database: InstrumentedDatabase,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  stats,
  statementStrategy: 'prepared'
});
assert.equal(count, chunkCount, 'expected sqlite build to ingest all chunks');
assert.ok(fsSync.existsSync(outPath), 'expected sqlite DB to be created');

const beginCount = execCalls.filter((call) => call === 'BEGIN').length;
const commitCount = execCalls.filter((call) => call === 'COMMIT').length;
const rollbackCount = execCalls.filter((call) => call === 'ROLLBACK').length;
assert.equal(beginCount, 1, 'expected exactly one explicit BEGIN in full build');
assert.equal(commitCount, 1, 'expected exactly one explicit COMMIT in full build');
assert.equal(rollbackCount, 0, 'expected no ROLLBACK in successful full build');

assert.equal(stats?.transaction?.begin, 1, 'expected stats.transaction.begin=1');
assert.equal(stats?.transaction?.commit, 1, 'expected stats.transaction.commit=1');
assert.equal(stats?.transaction?.rollback, 0, 'expected stats.transaction.rollback=0');

const beginIndex = execCalls.indexOf('BEGIN');
const commitIndex = execCalls.indexOf('COMMIT');
assert.ok(beginIndex >= 0 && commitIndex > beginIndex, 'expected BEGIN before COMMIT');

const indexExecIndex = execCalls.findIndex((call) => call.includes('CREATE INDEX idx_chunks_file_id'));
assert.ok(indexExecIndex > beginIndex, 'expected CREATE_INDEXES_SQL to execute after BEGIN');
assert.ok(indexExecIndex < commitIndex, 'expected CREATE_INDEXES_SQL to execute before COMMIT');

const db = new Database(outPath);
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
assert.equal(row?.total, chunkCount, 'expected sqlite chunks table to match chunk_meta count');
db.close();

console.log('sqlite build full transaction test passed');
