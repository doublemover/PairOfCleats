#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  beginSqliteBuildTransaction,
  commitSqliteBuildTransaction,
  createBuildExecutionContext,
  createSqliteBuildInsertContext,
  rollbackSqliteBuildTransaction
} from '../../../../src/storage/sqlite/build/core.js';

applyTestEnv();

const stats = {};
const context = createBuildExecutionContext({
  batchSize: 128,
  inputBytes: 4096,
  statementStrategy: 'unsupported',
  stats
});
assert.equal(context.resolvedBatchSize, 128);
assert.equal(context.resolvedStatementStrategy, 'multi-row');
assert.equal(stats.batchSize, 128);
assert.equal(stats.statementStrategy, 'multi-row');
context.recordBatch('tokenVocabBatches');
context.recordBatch('tokenVocabBatches');
assert.equal(stats.tokenVocabBatches, 2);
context.recordTable('chunks', 10, 50);
context.recordTable('chunks', 30, 150);
assert.equal(stats.tables.chunks.rows, 40);
assert.equal(stats.tables.chunks.durationMs, 200);
assert.equal(stats.tables.chunks.rowsPerSec, 200);

const preparedSql = [];
const fakeDb = {
  prepare(sql) {
    preparedSql.push(String(sql || '').trim());
    return {
      run() {},
      all() { return []; },
      get() { return null; },
      iterate() { return [][Symbol.iterator](); }
    };
  },
  transaction(fn) {
    return (...args) => fn(...args);
  }
};

const insertContext = createSqliteBuildInsertContext(fakeDb, {
  batchStats: stats,
  resolvedStatementStrategy: 'multi-row'
});
assert.equal(typeof insertContext.insertTokenVocab.run, 'function');
assert.equal(typeof insertContext.insertTokenPosting.run, 'function');
assert.equal(typeof insertContext.insertDocLength.run, 'function');
assert.equal(typeof insertContext.insertTokenVocabMany, 'function');
assert.equal(typeof insertContext.insertTokenPostingMany, 'function');
assert.equal(typeof insertContext.insertDocLengthMany, 'function');
insertContext.insertTokenVocabMany([
  ['code', 0, 'alpha'],
  ['code', 1, 'beta']
]);
insertContext.insertDocLengthMany([
  ['code', 0, 3]
]);
assert.ok(preparedSql.some((sql) => sql.includes('INTO token_vocab')), 'expected token_vocab statement');
assert.ok(preparedSql.some((sql) => sql.includes('INTO doc_lengths')), 'expected doc_lengths statement');

const txStats = { transaction: { begin: 0, commit: 0, rollback: 0 } };
const txDb = {
  inTransaction: false,
  exec(sql) {
    const normalized = String(sql || '').trim().toUpperCase();
    if (normalized === 'BEGIN') this.inTransaction = true;
    if (normalized === 'COMMIT' || normalized === 'ROLLBACK') this.inTransaction = false;
  }
};
beginSqliteBuildTransaction(txDb, txStats);
assert.equal(txStats.transaction.begin, 1);
assert.equal(txDb.inTransaction, true);
commitSqliteBuildTransaction(txDb, txStats);
assert.equal(txStats.transaction.commit, 1);
assert.equal(txDb.inTransaction, false);
rollbackSqliteBuildTransaction(txDb, txStats);
assert.equal(txStats.transaction.rollback, 0);
beginSqliteBuildTransaction(txDb, txStats);
rollbackSqliteBuildTransaction(txDb, txStats);
assert.equal(txStats.transaction.rollback, 1);

console.log('sqlite build core contract test passed');
