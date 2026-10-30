import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL, CREATE_INDEXES_SQL } from '../../../src/storage/sqlite/schema.js';
import { rebuildSqliteFilterFacts } from '../../../src/storage/sqlite/filter-facts.js';

const sql = 'SELECT id,chunk_id,mode,file,ext,kind,metaV2_json FROM chunks WHERE mode=? AND id>? ORDER BY id LIMIT 128';
for (const count of [0, 1, 128, 129, 512]) {
  const db = new Database(':memory:');
  try {
    db.exec(CREATE_TABLES_BASE_SQL + CREATE_INDEXES_SQL);
    const insert = db.prepare('INSERT INTO chunks(id,mode,file,ext,kind) VALUES (?,?,?,?,?)');
    const expected = [];
    for (let n = 0; n < count; n++) {
      const id = n * 3;
      insert.run(id, 'code', `src/${count - n}-界😀.js`, '.js', 'FunctionDeclaration');
      insert.run(id + 1, 'prose', `docs/${n}.md`, '.md', 'Prose'); expected.push(id);
    }
    const prepare = db.prepare, pages = [], plans = [];
    db.prepare = function (text) {
      const statement = prepare.call(db, text);
      if (/SELECT id,chunk_id,mode,file,ext,kind,metaV2_json FROM chunks/.test(text)) {
        plans.push(prepare.call(db, 'EXPLAIN QUERY PLAN ' + text).all('code', -1));
        const all = statement.all;
        statement.all = function (...args) { const rows = all.apply(statement, args); pages.push(rows.map(row => row.id)); return rows; };
      }
      return statement;
    };
    const built = await rebuildSqliteFilterFacts(db, 'code');
    assert.equal(built.rows, count); assert.equal(built.complete, true);
    assert.deepEqual(pages.flat(), expected);
    assert.ok(pages.every(page => page.length <= 128));
    assert.equal(pages.length, Math.ceil(count / 128) + 1);
    assert.ok(plans.flat().some(row => /INTEGER PRIMARY KEY.*rowid>\?/i.test(row.detail)));
    assert.ok(plans.flat().every(row => !/TEMP B-TREE/.test(row.detail)));
    const facts = prepare.call(db, 'SELECT doc_id,file,kind FROM chunk_filter_facts WHERE mode=? ORDER BY doc_id').all('code');
    assert.deepEqual(facts, expected.map((id, n) => ({ doc_id: id, file: `src/${count - n}-界😀.js`, kind: 'functiondeclaration' })));
    if (count === 512) {
      const baseline = prepare.call(db, 'EXPLAIN QUERY PLAN ' + sql).all('code', -1);
      assert.ok(baseline.some(row => /TEMP B-TREE/.test(row.detail)), 'old access path is the actual repeated-sort negative');
      assert.deepEqual(prepare.call(db, sql).all('code', -1), prepare.call(db, sql.replace('FROM chunks', 'FROM chunks NOT INDEXED')).all('code', -1));
      const control = new AbortController(), reason = new Error('original filter reconstruction abort');
      db.prepare = function (text) {
        const statement = prepare.call(db, text);
        if (/FROM chunks NOT INDEXED/.test(text)) {
          const all = statement.all;
          statement.all = function (...args) { const rows = all.apply(statement, args); control.abort(reason); return rows; };
        }
        return statement;
      };
      await assert.rejects(rebuildSqliteFilterFacts(db, 'code', { signal: control.signal }), error => error.cause === reason);
      assert.equal(prepare.call(db, 'SELECT COUNT(*) AS n FROM chunk_filter_facts_meta').get().n, 0);
    }
  } finally { db.close(); }
}
console.log('Actual SQLite filter reconstruction uses ordered primary-key ranges with exact mode/fact parity and cancellation.');
