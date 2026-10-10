#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { ingestSemanticPartition, removeSemanticSource } from '../../../src/storage/sqlite/semantic/ingest.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture();
const db = new Database(':memory:');
try {
  db.exec(CREATE_SEMANTIC_TABLES_SQL);
  db.exec('CREATE TABLE unrelated (value TEXT)');
  const descriptor = await fixture.write([semanticNode(0, fixture.source.textLength), semanticNode(1, fixture.source.textLength)]);
  const store = fixture.store([descriptor]);
  db.exec('BEGIN');
  await ingestSemanticPartition({ db, store, descriptor });
  db.exec('COMMIT');
  const tables = ['semantic_sources', 'semantic_analysis', 'semantic_records', 'semantic_operands',
    'semantic_edges', 'semantic_ownership', 'semantic_coverage', 'semantic_lookup'];
  const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM ' + table).all()]));
  const before = snapshot();
  for (const cancelAt of ['semantic_sources', 'semantic_records', 'semantic_coverage']) {
    const abort = new AbortController();
    const cancelledStore = {
      async *iterateRows(id, member, options) {
        let emitted = 0;
        for await (const row of store.iterateRows(id, member, options)) {
          yield row;
          emitted += 1;
          if (member === cancelAt && emitted === 1) abort.abort();
        }
        if (member === cancelAt) abort.abort();
      }
    };
    db.exec('BEGIN');
    db.prepare('INSERT INTO unrelated VALUES (?)').run(cancelAt);
    await assert.rejects(ingestSemanticPartition({ db, store: cancelledStore, descriptor, signal: abort.signal }),
      { name: 'AbortError' });
    assert.equal(db.inTransaction, true, 'partition rollback must leave caller transaction active');
    db.exec('COMMIT');
    assert.deepEqual(snapshot(), before, 'cancelled replacement restores every prior semantic table');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM unrelated').get().n, 3,
    'savepoint rollback preserves earlier unrelated caller writes');

  const empty = await fixture.write([], { partitionId: 'sy1:' + 'e'.repeat(64) });
  db.exec('BEGIN');
  const result = await ingestSemanticPartition({ db, store: fixture.store([empty]), descriptor: empty });
  db.exec('COMMIT');
  assert.equal(result.records, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_analysis').get().n, 2,
    'zero-record partition remains independently owned by source identity');
  db.exec('BEGIN');
  removeSemanticSource({ db, sourceUnitId: fixture.source.sourceUnitId });
  db.exec('COMMIT');
  for (const table of tables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
  console.log('semantic SQLite cancellation savepoints and zero-record removal passed');
} finally { db.close(); await fixture.cleanup(); }
