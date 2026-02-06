#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { validateSqliteDatabase } from '../../../src/storage/sqlite/build/validate.js';
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
const tempRoot = path.join(root, '.testCache', 'sqlite-build-validate-auto-fast-path');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const mode = 'code';
const chunkCount = 50;
const tokens = ['alpha', 'beta'];
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 3}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: mode,
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
  maxBytes: 4096,
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
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta artifacts');

await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode,
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  statementStrategy: 'prepared',
  buildPragmas: false,
  optimize: false
});

assert.ok(fsSync.existsSync(outPath), 'expected sqlite DB to be created');

const db = new Database(outPath);
const originalPrepare = db.prepare.bind(db);

const runValidate = (options) => {
  const calls = [];
  db.prepare = (sql) => {
    calls.push(String(sql));
    return originalPrepare(sql);
  };
  validateSqliteDatabase(db, mode, options);
  db.prepare = originalPrepare;
  return calls;
};

const fullCalls = runValidate({
  validateMode: 'auto',
  expected: { chunks: chunkCount, dense: 0, minhash: 0 },
  emitOutput: false,
  dbPath: outPath,
  fullIntegrityCheckMaxBytes: 1024 * 1024 * 1024
});
assert.ok(
  fullCalls.some((sql) => sql.includes('PRAGMA integrity_check')),
  'expected validateMode=auto to use integrity_check for small DBs'
);

const smokeCalls = runValidate({
  validateMode: 'auto',
  expected: { chunks: chunkCount, dense: 0, minhash: 0 },
  emitOutput: false,
  dbPath: outPath,
  fullIntegrityCheckMaxBytes: 0
});
assert.ok(
  smokeCalls.some((sql) => sql.includes('PRAGMA quick_check')),
  'expected validateMode=auto to use quick_check for large DBs'
);

assert.throws(
  () => {
    runValidate({
      validateMode: 'auto',
      expected: { chunks: chunkCount + 1, dense: 0, minhash: 0 },
      emitOutput: false,
      dbPath: outPath,
      fullIntegrityCheckMaxBytes: 0
    });
  },
  /chunks=/,
  'expected validateMode=auto to still enforce rowcount guards'
);

db.close();

console.log('sqlite validate auto fast path test passed');

