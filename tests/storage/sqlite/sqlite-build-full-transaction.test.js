#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-full-transaction');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 2000;
const tokens = ['alpha', 'beta'];
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 5}.js`,
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

const indexExecIndex = execCalls.findIndex((call) => call.includes('CREATE INDEX idx_chunks_file'));
assert.ok(indexExecIndex > beginIndex, 'expected CREATE_INDEXES_SQL to execute after BEGIN');
assert.ok(indexExecIndex < commitIndex, 'expected CREATE_INDEXES_SQL to execute before COMMIT');

const db = new Database(outPath);
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
assert.equal(row?.total, chunkCount, 'expected sqlite chunks table to match chunk_meta count');
db.close();

console.log('sqlite build full transaction test passed');

