import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteModeRowLedger, validateSqliteRowLedgerPreImport, validateSqliteRowLedgerPostImport } from '../../../../src/storage/sqlite/build/runner/row-ledger.js';
import { readSqliteModeRowCounts } from '../../../../src/storage/sqlite/build/runner/sqlite-probes.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { errorGraphIncludes } from '../../../helpers/error-graph.js';

// UNVALIDATED: exact count/absence/capability owners. Native cases use one tiny
// staged database; all other cases use explicit count evidence, never a backend.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const invalid = { undefined, null: null, nan: NaN, infinity: Infinity, negative: -1, fractional: 0.5,
  unsafe: Number.MAX_SAFE_INTEGER + 1, string: '0', boolean: false };
const named = ['pre-extra-zero', 'post-extra-zero', 'ready-empty-ann', 'ready-absent-ann', 'disabled-ann',
  'optional-absent', 'file-count-unavailable', 'pending-snapshot', 'native-zero', 'native-positive',
  'native-query-failure', 'native-required-ann', 'native-empty-ann', 'native-one-transaction'];
assert.ok(named.includes(selected) || /^(pre|post)-(undefined|null|nan|infinity|negative|fractional|unsafe|string|boolean)$/u.test(selected));
const ledger = (chunks = 0, dense = 0) => createSqliteModeRowLedger({ mode: 'code', source: 'artifacts',
  expectedChunkCount: chunks, expectedDenseCount: dense, expectedFileCount: 0 });
const snapshot = (changes = {}) => ({ chunks: 0, dense: 0, files: 0, ann: null, annPresent: false, ...changes });
const post = (rowLedger, data, extra = {}) => validateSqliteRowLedgerPostImport({ rowLedger,
  Database: null, dbPath: path.resolve('.tmp/unused-ledger.db'), probe: { readSnapshot: () => data }, ...extra });
if (selected.startsWith('native-')) {
  const { default: Database } = await import('better-sqlite3');
  const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-ledger-evidence-${selected}`);
  const target = path.join(root, 'ledger.db'), writer = new Database(target);
  try {
    writer.exec(CREATE_TABLES_SQL); writer.pragma(`user_version = ${SCHEMA_VERSION}`); writeSqliteIndexFormat(writer);
    if (selected !== 'native-zero') {
      writer.prepare('INSERT INTO chunks (id, mode, file, start, end) VALUES (0, ?, ?, 0, 1)').run('code', 'source.js');
      writer.prepare('INSERT INTO file_manifest (mode, file, hash, chunk_count) VALUES (?, ?, ?, 1)').run('code', 'source.js', 'source-hash');
    }
    if (selected === 'native-empty-ann') {
      writer.exec('CREATE TABLE dense_vectors_ann (rowid INTEGER PRIMARY KEY)');
      writer.prepare('INSERT INTO dense_vectors (mode, doc_id, vector) VALUES (?, 0, ?)').run('code', Buffer.from([128]));
    }
  } finally { writer.close(); }
  const originalPrepare = Database.prototype.prepare, originalClose = Database.prototype.close;
  let countQueries = 0, handles = new Set(), closes = 0, transactionChecks = 0, passed = false;
  const fault = Object.freeze(Object.assign(new Error('original required ledger query failure'), { code: 'EIO' }));
  Database.prototype.prepare = function (sql, ...args) {
    if (this.name === target && (/COUNT\(\*\)/u.test(sql) || sql.includes('sqlite_master') && this.inTransaction)) {
      handles.add(this); transactionChecks++; assert.equal(this.inTransaction, true, 'capability and all row counts share one read transaction');
      if (/COUNT\(\*\)/u.test(sql)) countQueries++;
      if (selected === 'native-query-failure' && sql.includes('FROM dense_vectors WHERE')) throw fault;
    }
    return originalPrepare.call(this, sql, ...args);
  };
  Database.prototype.close = function () { if (this.name === target) closes++; return originalClose.call(this); };
  try {
    const input = { Database, dbPath: target, mode: 'code' };
    if (selected === 'native-query-failure') assert.throws(() => readSqliteModeRowCounts(input), error => errorGraphIncludes(error, fault));
    else {
      const result = validateSqliteRowLedgerPostImport({ ...input, rowLedger: ledger(selected === 'native-zero' ? 0 : 1,
        selected === 'native-empty-ann' ? 1 : 0), annExpectation: ['native-required-ann', 'native-empty-ann'].includes(selected) ? 'ready' : 'disabled' });
      assert.equal(result.ok, !['native-required-ann', 'native-empty-ann'].includes(selected));
      if (selected === 'native-required-ann') assert.match(result.message, /required ANN.*unavailable/u);
      if (selected === 'native-empty-ann') assert.match(result.message, /ANN count mismatch/u);
      if (result.ok) {
        assert.equal(result.observed.chunks, selected === 'native-zero' ? 0 : 1);
        assert.equal(result.coverage.identities, 'unqualified');
      }
    }
    assert.equal(handles.size, 1); assert.equal(closes, 1); assert.ok(transactionChecks >= 2);
    if (selected === 'native-one-transaction') assert.equal(countQueries, 3);
    passed = true;
  } finally {
    Database.prototype.prepare = originalPrepare; Database.prototype.close = originalClose;
    if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
  }
} else if (Object.hasOwn(invalid, selected.replace(/^(pre|post)-/u, ''))) {
  const value = invalid[selected.replace(/^(pre|post)-/u, '')];
  const result = selected.startsWith('pre-') ? validateSqliteRowLedgerPreImport({ rowLedger: ledger(), bundleResult: { count: value, denseCount: 0 } })
    : post(ledger(), snapshot({ chunks: value }));
  assert.equal(result.ok, false); assert.equal(result.failureClass, 'input_invalid');
  assert.equal(result.observed.chunks, null, 'unknown/invalid evidence remains unavailable rather than measured zero');
  const expected = ledger(value, 0); assert.equal(expected.expected.chunks, null);
  assert.equal(post(expected, snapshot()).ok, false);
} else if (selected === 'pre-extra-zero') {
  const result = validateSqliteRowLedgerPreImport({ rowLedger: ledger(2, 0), bundleResult: { count: 2, denseCount: 1 } });
  assert.equal(result.ok, false); assert.equal(result.code, 'ERR_SQLITE_PREIMPORT_DENSE_COUNT_MISMATCH');
} else if (selected === 'pending-snapshot') {
  let ready = false;
  const data = Object.freeze({ ...snapshot(), cacheOwnershipReleased: () => ready });
  let failure; assert.throws(() => post(ledger(), data), error => { failure = error; return errorGraphIncludes(error, data); });
  assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
} else {
  const expectations = {
    'post-extra-zero': [ledger(2, 0), snapshot({ chunks: 2, dense: 1 }), 'optional', false],
    'ready-empty-ann': [ledger(1, 1), snapshot({ chunks: 1, dense: 1, ann: 0, annPresent: true }), 'ready', false],
    'ready-absent-ann': [ledger(1, 1), snapshot({ chunks: 1, dense: 1 }), 'ready', false],
    'disabled-ann': [ledger(1, 1), snapshot({ chunks: 1, dense: 1 }), 'disabled', true],
    'optional-absent': [ledger(), snapshot(), 'optional', true],
    'file-count-unavailable': [ledger(), snapshot({ files: null }), 'disabled', false]
  };
  const [expected, data, annExpectation, ok] = expectations[selected], result = post(expected, data, { annExpectation });
  assert.equal(result.ok, ok);
  if (ok) { assert.equal(result.observed.ann, null); assert.equal(result.coverage.identities, 'unqualified'); }
}
console.log(`SQLite ledger count/capability evidence: ${selected}`);
