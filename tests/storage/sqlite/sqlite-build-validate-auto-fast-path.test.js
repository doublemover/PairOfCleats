#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';

import { validateSqliteDatabase } from '../../../src/storage/sqlite/build/validate.js';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';

const chunkCount = 50;
const mode = 'code';
const fixture = await setupSqliteBuildFixture({
  tempLabel: 'sqlite-build-validate-auto-fast-path',
  chunkCount,
  fileCount: 3,
  mode
});

assert.ok(fixture.indexPieces, 'expected loadIndexPieces to detect chunk_meta artifacts');
assert.ok(fsSync.existsSync(fixture.outPath), 'expected sqlite DB to be created');

const db = new fixture.Database(fixture.outPath);
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
  dbPath: fixture.outPath,
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
  dbPath: fixture.outPath,
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
      dbPath: fixture.outPath,
      fullIntegrityCheckMaxBytes: 0
    });
  },
  /chunks=/,
  'expected validateMode=auto to still enforce rowcount guards'
);

db.close();

console.log('sqlite validate auto fast path test passed');

