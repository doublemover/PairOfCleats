import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSqliteRowCorrespondence } from '../../../../src/storage/sqlite/build/row-correspondence.js';
import { createSqliteModeRowLedger, validateSqliteRowLedgerPostImport } from '../../../../src/storage/sqlite/build/runner/row-ledger.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

// UNVALIDATED: tiny actual SQL relations and the actual post-import transaction;
// no source corpus, external process, extension download or physical link.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['healthy-empty', 'healthy-full', 'empty-manifest-entry', 'dense-wrong-id', 'dense-wrong-mode',
  'missing-file', 'file-chunk-count', 'file-count-null', 'ann-wrong-id', 'ann-missing', 'ann-extra',
  'ann-disabled-empty', 'bounded-samples', 'required-query-error', 'outside-transaction', 'forged-snapshot'].includes(selected));
if (selected === 'forged-snapshot') {
  let calls = 0;
  assert.throws(() => validateSqliteRowLedgerPostImport({ dbPath: path.resolve('.tmp/unopened.db'),
    rowLedger: createSqliteModeRowLedger({ mode: 'code', expectedChunkCount: 0, expectedDenseCount: 0 }),
    probe: { readSnapshot: () => { calls++; return { chunks: 0, dense: 0, files: 0, ann: null, annPresent: false,
      correspondence: { ok: true, coverage: { files: 'fabricated' } } }; } }
  }), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
  assert.equal(calls, 1);
} else {
  const { default: Database } = await import('better-sqlite3');
  const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-correspondence-${selected}`);
  const target = path.join(root, 'relations.db'), db = new Database(target);
  let passed = false;
  const count = selected === 'healthy-empty' ? 0 : selected === 'bounded-samples' ? 40 : 1;
  const hasAnn = selected.startsWith('ann-') || selected === 'healthy-full';
  const disabled = selected === 'ann-disabled-empty' || !hasAnn;
  try {
    db.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(db); db.pragma(`user_version = ${SCHEMA_VERSION}`);
    const chunk = db.prepare('INSERT INTO chunks (id, mode, file, start, end) VALUES (?, ?, ?, 0, 1)');
    const dense = db.prepare('INSERT INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)');
    const manifest = db.prepare('INSERT INTO file_manifest (mode, file, hash, chunk_count) VALUES (?, ?, ?, ?)');
    for (let id = 0; id < count; id++) {
      chunk.run(id, 'code', 'source.js');
      dense.run('code', selected === 'bounded-samples' ? 100 + id : id, Buffer.from([128]));
    }
    if (count) manifest.run('code', 'source.js', 'source-hash', count);
    if (hasAnn) {
      db.exec('CREATE TABLE dense_vectors_ann (rowid INTEGER PRIMARY KEY)');
      if (!['ann-missing', 'ann-disabled-empty'].includes(selected)) db.prepare('INSERT INTO dense_vectors_ann VALUES (?)').run(selected === 'ann-wrong-id' ? 1 : 0);
      if (selected === 'ann-extra') db.prepare('INSERT INTO dense_vectors_ann VALUES (2)').run();
    }
    if (selected === 'empty-manifest-entry') manifest.run('code', 'empty.js', 'empty-source-hash', 0);
    if (selected === 'dense-wrong-id') db.exec('UPDATE dense_vectors SET doc_id = 3');
    if (selected === 'dense-wrong-mode') {
      db.exec("UPDATE chunks SET mode = 'prose'"); chunk.run(1, 'code', 'source.js');
    }
    if (selected === 'missing-file') db.exec('DELETE FROM file_manifest');
    if (selected === 'file-chunk-count') db.exec('UPDATE file_manifest SET chunk_count = 2');
    if (selected === 'file-count-null') db.exec('UPDATE file_manifest SET chunk_count = NULL');
    if (selected === 'outside-transaction') {
      assert.throws(() => readSqliteRowCorrespondence(db, 'code'), /original read transaction/u);
    } else if (selected === 'required-query-error') {
      const original = db.prepare, fault = Object.freeze(new Error('original relation query failed'));
      db.prepare = function (sql, ...args) { if (sql.includes('d.doc_id AS docId')) throw fault; return original.call(this, sql, ...args); };
      assert.throws(() => db.transaction(() => readSqliteRowCorrespondence(db, 'code'))(), error => error === fault);
      db.prepare = original;
    } else {
      const result = db.transaction(() => readSqliteRowCorrespondence(db, 'code', { checkAnn: hasAnn && !disabled }))();
      const healthy = ['healthy-empty', 'healthy-full', 'empty-manifest-entry', 'ann-disabled-empty'].includes(selected);
      assert.equal(result.ok, healthy);
      assert.equal(result.coverage.sourceHashes, 'unqualified');
      if (selected === 'bounded-samples') {
        assert.equal(result.anomalies.denseWithoutChunk.length, 16); assert.deepEqual(result.truncated, ['denseWithoutChunk']);
      }
      if (selected === 'ann-wrong-id') {
        assert.deepEqual(result.anomalies.denseWithoutAnn, [{ docId: 0 }]);
        assert.deepEqual(result.anomalies.annWithoutDense, [{ rowId: 1 }]);
      }
      if (selected === 'ann-disabled-empty') {
        assert.equal(result.coverage.ann, 'not-admitted'); assert.equal(Object.hasOwn(result.anomalies, 'denseWithoutAnn'), false);
      }
      db.close();
      const post = validateSqliteRowLedgerPostImport({ Database, dbPath: target,
        rowLedger: createSqliteModeRowLedger({ mode: 'code', expectedChunkCount: count, expectedDenseCount: count }),
        annExpectation: disabled ? 'disabled' : 'ready' });
      assert.equal(post.ok, healthy);
      if (!healthy && !['ann-missing', 'ann-extra'].includes(selected)) {
        assert.equal(post.code, 'ERR_SQLITE_POSTIMPORT_CORRESPONDENCE_MISMATCH');
        assert.equal(post.failureClass, 'row_identity_mismatch');
      }
      if (healthy) assert.equal(post.coverage.correspondence.dense, 'native-chunk-membership');
    }
    passed = true;
  } finally { if (db.open) db.close(); }
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`SQLite bounded native row correspondence: ${selected}`);
