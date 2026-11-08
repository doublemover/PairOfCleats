#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deleteDocIds } from '../../../src/storage/sqlite/build/delete.js';
import { toSqliteRowId } from '../../../src/storage/sqlite/vector.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createSqliteBenchmarkWorkload, resolveSqliteBenchmarkPlan } from '../../../tools/bench/sqlite/workload.js';
import { validateSqliteBenchDatabase } from '../../../tools/bench/sqlite/validate.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { copySqliteBenchSeed } from '../../../tools/bench/sqlite/campaign-arm.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required for sqlite build delete test.');
  process.exit(1);
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE chunks (id INTEGER, mode TEXT);
  CREATE TABLE chunks_fts (rowid INTEGER, mode TEXT);
  CREATE TABLE token_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE phrase_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE chargram_postings (doc_id INTEGER, mode TEXT);
  CREATE TABLE minhash_signatures (doc_id INTEGER, mode TEXT);
  CREATE TABLE dense_vectors (doc_id INTEGER, mode TEXT);
  CREATE TABLE doc_lengths (doc_id INTEGER, mode TEXT);
  CREATE TABLE dense_vectors_ann (id INTEGER PRIMARY KEY, embedding BLOB);
  CREATE TABLE dense_vectors_ann_rowid (embedding BLOB);
`);

const insertChunk = db.prepare('INSERT INTO chunks (id, mode) VALUES (?, ?)');
const insertChunkFts = db.prepare('INSERT INTO chunks_fts (rowid, mode) VALUES (?, ?)');
const insertDoc = (table) => db.prepare(`INSERT INTO ${table} (doc_id, mode) VALUES (?, ?)`);
const insertAnn = db.prepare('INSERT INTO dense_vectors_ann (id, embedding) VALUES (?, ?)');
const insertAnnRowid = db.prepare('INSERT INTO dense_vectors_ann_rowid (rowid, embedding) VALUES (?, ?)');

for (const id of [1, 2]) {
  insertChunk.run(id, 'code');
  insertChunkFts.run(id, 'code');
  insertDoc('token_postings').run(id, 'code');
  insertDoc('phrase_postings').run(id, 'code');
  insertDoc('chargram_postings').run(id, 'code');
  insertDoc('minhash_signatures').run(id, 'code');
  insertDoc('dense_vectors').run(id, 'code');
  insertDoc('doc_lengths').run(id, 'code');
  insertAnn.run(id, Buffer.from('x'));
}

insertChunk.run(1, 'prose');
insertChunkFts.run(1, 'prose');
insertDoc('token_postings').run(1, 'prose');
insertDoc('doc_lengths').run(1, 'prose');
insertAnn.run(3, Buffer.from('y'));
const bigRowId = 9007199254740991n;
insertAnnRowid.run(bigRowId, Buffer.from('z'));

deleteDocIds(db, 'code', [1, 2], [{ table: 'dense_vectors_ann', column: 'id', withMode: false }]);
deleteDocIds(
  db,
  'code',
  [bigRowId],
  [{ table: 'dense_vectors_ann_rowid', column: 'rowid', withMode: false, transform: toSqliteRowId }]
);

const remainingCodeChunks = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code').total;
assert.equal(remainingCodeChunks, 0, 'expected code chunks to be removed');
const remainingProseChunks = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('prose').total;
assert.equal(remainingProseChunks, 1, 'expected prose chunks to remain');

const remainingTokens = db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ?').get('code').total;
assert.equal(remainingTokens, 0, 'expected code token postings to be removed');

const remainingAnn = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors_ann').get().total;
assert.equal(remainingAnn, 1, 'expected ANN rows to be removed for deleted ids');

const remainingAnnRow = db.prepare('SELECT id FROM dense_vectors_ann').get();
assert.equal(remainingAnnRow.id, 3, 'expected ANN row for other ids to remain');

const remainingAnnRowid = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors_ann_rowid').get().total;
assert.equal(remainingAnnRowid, 0, 'expected rowid-based ANN delete to remove BigInt id');

db.close();


// Observe the actual incremental owner, not a substitute deletion algorithm.
// All nine stale-file groups fit the original large-delete staging policy.
const { dir } = await prepareIsolatedTestCacheDir('sqlite-incremental-delete-coalescing');
try {
  const bundleDir = path.join(dir, 'bundles'); await fs.mkdir(bundleDir);
  const plan = resolveSqliteBenchmarkPlan({ files: '32', chunks: '256', tokens: '8', vocabulary: '4096',
    trials: '1', rounds: '1', 'changed-files': '8', 'added-files': '1', 'deleted-files': '1',
    'shrink-files': '1', 'grow-files': '1' }, 'update');
  const workload = await createSqliteBenchmarkWorkload({ bundleDir, plan, sqliteMode: 'code' });
  const nativeCalls = [], nativeTransactions = [];
  let forcedDelete = null, forcedCleanup = null;
  const ObservedDatabase = function (...args) {
    const native = new Database(...args), prepare = native.prepare, exec = native.exec;
    let tempDrops = 0;
    native.exec = function (sql, ...values) {
      const transaction = /^(BEGIN|COMMIT|ROLLBACK)\b/u.exec(sql.trim());
      if (transaction) nativeTransactions.push(transaction[1]);
      if (/^DROP TABLE IF EXISTS temp_doc_ids/u.test(sql) && ++tempDrops === 2 && forcedCleanup) throw forcedCleanup;
      return exec.call(native, sql, ...values);
    };
    native.prepare = function (sql) {
      const statement = prepare.call(native, sql);
      if (/^DELETE FROM token_postings /u.test(sql)) {
        const originalRun = statement.run;
        statement.run = function (...values) {
          nativeCalls.push({ sql, values }); if (forcedDelete) throw forcedDelete;
          return originalRun.apply(statement, values);
        };
      }
      return statement;
    };
    return native;
  };
  const outPath = path.join(dir, 'update.db');
  const common = { Database: ObservedDatabase, outPath, mode: 'code', vectorConfig: { enabled: false },
    modelConfig: { id: null }, emitOutput: false, validateMode: 'off',
    envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } };
  const built = await buildDatabaseFromBundles({ ...common, incrementalData: { manifest: workload.initial.manifest, bundleDir } });
  assert.equal(built.count, 8192);
  const initial = await validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir,
    manifest: workload.initial.manifest, mode: 'code', expectedRows: 8192 });
  const rollbackPath = path.join(dir, 'rollback.db'); await copySqliteBenchSeed(Database, outPath, rollbackPath);
  nativeTransactions.length = 0;
  const step = workload.rounds[0], stats = {};
  const updated = await incrementalUpdateDatabase({ ...common, stats, incrementalData: { manifest: step.manifest, bundleDir } });
  assert.equal(updated.used, true, updated.reason);
  assert.equal(updated.changedFiles, step.changedFiles); assert.equal(updated.deletedFiles, step.deletedFiles);
  assert.equal(updated.insertedChunks, step.insertedChunks);
  const observation = await validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir,
    manifest: step.manifest, mode: 'code', expectedRows: 8192 });
  assert.notEqual(observation.stableContentSha256, initial.stableContentSha256);
  assert.equal(nativeCalls.length, 1, 'All stale-file groups must share one native postings deletion, not repeat a mode scan per file');
  assert.match(nativeCalls[0].sql, /IN \(SELECT id FROM temp_doc_ids\)/u);
  assert.deepEqual(nativeTransactions, ['BEGIN', 'COMMIT']);
  assert.deepEqual(stats.transactionPhases, { deletes: true, inserts: true });

  forcedDelete = Object.freeze(new Error('original native postings deletion failed'));
  forcedCleanup = Object.freeze(new Error('original temporary ID cleanup failed'));
  nativeTransactions.length = 0;
  await assert.rejects(incrementalUpdateDatabase({ ...common, outPath: rollbackPath,
    incrementalData: { manifest: step.manifest, bundleDir } }), error => {
    const pending = [error], seen = new Set();
    while (pending.length) {
      const value = pending.pop(); if (!value || seen.has(value)) continue; seen.add(value);
      if (value.cause) pending.push(value.cause); if (Array.isArray(value.errors)) pending.push(...value.errors);
    }
    assert.ok(seen.has(forcedDelete), 'Retain the exact native primary failure');
    assert.ok(seen.has(forcedCleanup), 'Retain the exact temporary-table cleanup failure');
    return true;
  });
  assert.deepEqual(nativeTransactions, ['BEGIN', 'ROLLBACK']);
  assert.deepEqual(await validateSqliteBenchDatabase({ Database, dbPath: rollbackPath, bundleDir,
    manifest: workload.initial.manifest, mode: 'code', expectedRows: 8192 }), initial,
  'The original all-or-nothing transaction restores every source/FTS/posting/filter observation after both failures');
} finally { await fs.rm(dir, { recursive: true, force: true }); }

console.log('sqlite build delete test passed');
