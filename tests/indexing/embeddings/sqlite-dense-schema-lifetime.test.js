import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hasSqliteDenseTable, resolveSqliteDenseVectorTableDims } from '../../../tools/build/embeddings/sqlite-dense-schema.js';
import { createSqliteDenseLifetime, getSqliteDenseLifetime } from '../../../tools/build/embeddings/sqlite-dense-lifetime.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: inert query/lifetime controls plus eight tiny actual SQLite paths.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['table-present', 'table-absent', 'table-failure', 'table-pending', 'table-invalid',
  'dims-type', 'dims-ddl', 'dims-second-column', 'dims-absent', 'dims-failure', 'dims-ddl-failure', 'dims-invalid', 'dims-pending', 'identifier',
  'dims-fake-default', 'dims-oversize-ddl',
  'captured-close', 'pending-work', 'replaced-work-observer', 'source-close-failure', 'db-close-failure', 'dual-close-failure',
  'source-close-async', 'source-return-pending', 'close-getter-failure',
  'native-table-failure', 'native-pragma-failure', 'native-close-replacement', 'native-work-close', 'native-null-close',
  'native-pending', 'native-pending-replaced', 'native-constructor'];
assert.ok(cases.includes(selected));
let ready = false, queries = 0, catalogQueries = 0, dbCloses = 0, sourceCloses = 0;
const primary = Object.freeze(Object.assign(new Error('exact original schema/work failure'), { code: 'SQLITE_BUSY' }));
const secondary = Object.freeze(new Error('exact original close failure'));
const pendingError = Object.assign(new Error('original independent work owner'), { cacheOwnershipReleased: () => ready });
if (selected.startsWith('table-') || selected.startsWith('dims-') || selected === 'identifier') {
  const pendingRow = Object.freeze({ name: 'dense_vectors', cacheOwnershipReleased: () => ready });
  const rows = [{ name: 'embedding', type: selected === 'dims-type' ? 'FLOAT[3]' : selected === 'dims-invalid' ? 'FLOAT[0]' : '' }];
  if (selected === 'dims-absent') rows[0].name = 'other';
  if (selected === 'dims-pending') Object.defineProperty(rows, 'cacheOwnershipReleased', { value: () => ready });
  const db = { prepare(sql) { queries++;
    if (selected === 'table-failure' || selected === 'dims-failure') throw primary;
    if (sql.startsWith('PRAGMA')) return { all: () => rows };
    if (sql.startsWith('SELECT name')) return { get: () => selected === 'table-absent' ? undefined : selected === 'table-invalid' ? null
      : selected === 'table-pending' ? pendingRow : { name: 'dense_vectors' } };
    catalogQueries++; if (selected === 'dims-ddl-failure') throw primary;
    return { get: () => ({ sql: selected === 'dims-second-column'
      ? 'CREATE VIRTUAL TABLE ann USING vec0(other float[5], embedding float[3])'
      : selected === 'dims-fake-default' ? "CREATE TABLE ann(embedding TEXT DEFAULT 'USING vec0(embedding float[3])')"
        : selected === 'dims-oversize-ddl' ? 'CREATE VIRTUAL TABLE ann USING vec0(embedding float[3])' + ' '.repeat(65536)
          : 'CREATE VIRTUAL TABLE ann USING vec0(embedding float[3])' }) };
  } };
  if (selected === 'table-present') assert.equal(hasSqliteDenseTable(db, 'dense_vectors'), true);
  else if (selected === 'table-absent') assert.equal(hasSqliteDenseTable(db, 'dense_vectors'), false);
  else if (['dims-type', 'dims-ddl'].includes(selected)) assert.equal(resolveSqliteDenseVectorTableDims(db, 'ann', 'embedding'), 3);
  else if (['dims-second-column', 'dims-absent', 'dims-fake-default'].includes(selected)) assert.equal(resolveSqliteDenseVectorTableDims(db, 'ann', 'embedding'), null);
  else {
    let failure;
    assert.throws(() => selected.startsWith('table-') ? hasSqliteDenseTable(db, 'dense_vectors')
      : resolveSqliteDenseVectorTableDims(db, selected === 'identifier' ? 'ann);DROP TABLE chunks' : 'ann', 'embedding'), error => { failure = error; return true; });
    if (['table-failure', 'dims-failure', 'dims-ddl-failure'].includes(selected)) assert.ok(errorGraphIncludes(failure, primary));
    if (selected === 'table-pending' || selected === 'dims-pending') {
      assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
    }
    if (selected === 'identifier') assert.equal(queries, 0);
  }
  if (['dims-type', 'dims-absent', 'dims-failure', 'dims-pending'].includes(selected)) assert.equal(catalogQueries, 0);
} else if (!selected.startsWith('native-')) {
  let failDb = selected === 'db-close-failure' || selected === 'dual-close-failure';
  const source = { close() {
    sourceCloses++;
    if (selected === 'source-close-failure' || selected === 'dual-close-failure') throw primary;
    if (selected === 'source-close-async') return Promise.reject(primary);
    if (selected === 'source-return-pending') return { cacheOwnershipReleased: () => ready };
  } };
  if (selected === 'close-getter-failure') {
    Object.defineProperty(source, 'close', { get() { sourceCloses++; throw primary; } });
    assert.throws(() => createSqliteDenseLifetime(source), error => errorGraphIncludes(error, primary));
    assert.equal(sourceCloses, 1);
  } else {
    const lifetime = createSqliteDenseLifetime(source);
    const db = { close() { dbCloses++; if (failDb) throw secondary; return this; } }; lifetime.attachDatabase(db);
    if (selected === 'captured-close') {
      source.close = db.close = () => assert.fail('late close replacement cannot replace the captured original');
      assert.equal(lifetime.close().settled, true); assert.equal(lifetime.close().settled, true);
      assert.equal(dbCloses, 1); assert.equal(sourceCloses, 1);
    } else if (selected === 'pending-work' || selected === 'replaced-work-observer') {
      lifetime.rememberWork(pendingError);
      let failure; assert.throws(() => lifetime.close(), error => { failure = error; return true; });
      assert.equal(getSqliteDenseLifetime(failure), lifetime); assert.equal(dbCloses, 0); assert.equal(sourceCloses, 0);
      if (selected === 'replaced-work-observer') pendingError.cacheOwnershipReleased = () => true;
      assert.throws(() => lifetime.recoverResources()); assert.equal(dbCloses, 0);
      ready = true; assert.equal(lifetime.recoverResources().settled, true); assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal(dbCloses, 1); assert.equal(sourceCloses, 1);
    } else {
      let failure; assert.throws(() => lifetime.close(), error => { failure = error; return true; });
      assert.equal(lifetime.isSettled(), false); assert.equal(dbCloses, 1); assert.equal(sourceCloses, 1);
      if (selected === 'db-close-failure' || selected === 'dual-close-failure') assert.ok(errorGraphIncludes(failure, secondary));
      if (selected === 'source-close-failure' || selected === 'dual-close-failure') assert.ok(errorGraphIncludes(failure, primary));
      if (selected === 'db-close-failure') {
        failDb = false; assert.equal(lifetime.recoverResources().settled, true); assert.equal(sourceCloses, 1);
      } else {
        failDb = false; ready = true; await Promise.resolve();
        assert.throws(() => lifetime.recoverResources(), error => selected === 'source-close-async' ? errorGraphIncludes(error, primary) : true);
        assert.equal(sourceCloses, 1, 'unknown source close is never repeated from copied or asynchronous evidence');
      }
    }
  }
} else {
  const { default: Database } = await import('better-sqlite3');
  const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-dense-owner-${selected}`);
  const dbPath = path.join(root, 'index.db'); let passed = false, injected = true, tableQueries = 0;
  const seed = new Database(dbPath);
  try {
    seed.exec('CREATE TABLE dense_vectors(mode TEXT,doc_id INTEGER,vector BLOB,PRIMARY KEY(mode,doc_id));CREATE TABLE dense_meta(mode TEXT PRIMARY KEY,dims INTEGER,scale REAL,model TEXT)');
    seed.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(seed);
    seed.prepare('INSERT INTO dense_vectors VALUES(?,?,?)').run('code', 0, Buffer.from([1]));
  } finally { seed.close(); }
  const ObservedDatabase = function (file) {
    if (selected === 'native-constructor') throw primary;
    const db = new Database(file), prepare = db.prepare.bind(db), pragma = db.pragma.bind(db), close = db.close.bind(db);
    db.close = function () { dbCloses++; if (injected && ['native-work-close', 'native-null-close'].includes(selected)) throw secondary; return close(); };
    db.prepare = sql => {
      if (selected === 'native-close-replacement') db.close = () => assert.fail('late native close replacement must not run');
      const statement = prepare(sql);
      if (sql.startsWith('SELECT name FROM sqlite_master')) {
        const get = statement.get.bind(statement);
        statement.get = (...parameters) => {
          const table = parameters[0];
          if (table === 'dense_vectors' || table === 'dense_meta') {
            tableQueries++;
            if (selected === 'native-null-close') throw null;
            if (['native-pending', 'native-pending-replaced'].includes(selected)) throw pendingError;
            if (['native-table-failure', 'native-work-close'].includes(selected)) throw primary;
          }
          return get(...parameters);
        };
      }
      return statement;
    };
    db.pragma = (...args) => { if (selected === 'native-pragma-failure' && args[0] === 'synchronous = NORMAL') throw primary; return pragma(...args); };
    return db;
  };
  try {
    const call = () => updateSqliteDense({ Database: ObservedDatabase, root, dbPath, mode: 'code', vectors: [[9]], dims: 1, scale: 1,
      modelId: 'fixture', userConfig: { sqlite: { vectorExtension: { enabled: false } } }, emitOutput: false });
    if (selected === 'native-close-replacement') { assert.equal(call().skipped, false); assert.equal(dbCloses, 1); }
    else {
      let failure; assert.throws(call, error => { failure = error; return true; });
      if (selected === 'native-constructor') assert.equal(failure, primary);
      else if (selected === 'native-null-close') assert.ok(errorGraphIncludes(failure, null));
      else assert.ok(errorGraphIncludes(failure, selected.startsWith('native-pending') ? pendingError : primary));
      if (['native-work-close', 'native-null-close'].includes(selected)) {
        assert.ok(errorGraphIncludes(failure, secondary)); injected = false;
        assert.equal(getSqliteDenseLifetime(failure).recoverResources().settled, true);
      }
      if (selected.startsWith('native-pending')) {
        assert.equal(dbCloses, 0); const lifetime = getSqliteDenseLifetime(failure); assert.ok(lifetime);
        if (selected === 'native-pending-replaced') pendingError.cacheOwnershipReleased = () => true;
        assert.throws(() => lifetime.recoverResources()); assert.equal(dbCloses, 0);
        ready = true; assert.equal(lifetime.recoverResources().settled, true); assert.equal(dbCloses, 1); assert.equal(tableQueries, 1);
      }
    }
    const readback = new Database(dbPath, { readonly: true });
    try { assert.deepEqual([...readback.prepare('SELECT vector FROM dense_vectors WHERE mode=? AND doc_id=0').get('code').vector],
      selected === 'native-close-replacement' ? [9] : [1]); }
    finally { readback.close(); }
    passed = true;
  } finally {
    ready = true; injected = false;
    if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
  }
}
console.log(`SQLite dense schema and original cleanup ownership: ${selected}`);
