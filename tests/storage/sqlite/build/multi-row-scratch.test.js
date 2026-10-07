#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createMultiRowInserter } from '../../../../src/storage/sqlite/build/multi-row.js';

// Observe the existing parameter-push seam without adding production counters.
// Keep the spread call convention intact, including SQLite's array bind behavior.
const receivers = new Set();
const snapshots = [];
const originalPush = Array.prototype.push;
const fakeDb = { prepare: () => ({ run: (...values) => { snapshots.push(values); } }) };
const insert = createMultiRowInserter(fakeDb, { table: 'items', columns: ['id', 'value'], maxRows: 3 });
Array.prototype.push = function(...values) {
  if (typeof values[0] === 'string' && values[0].startsWith('scratch-payload-')) receivers.add(this);
  return originalPush.apply(this, values);
};
try {
  insert(Array.from({ length: 7 }, (_, index) => [`scratch-payload-${index}`, index]));
} finally {
  Array.prototype.push = originalPush;
}
assert.equal(receivers.size, 1, 'one parameter scratch array per insertion call, rather than per batch');
assert.deepEqual(snapshots.map((values) => values.length), [6, 6, 2]);
assert.deepEqual(snapshots.flat(), Array.from({ length: 7 }, (_, index) => [`scratch-payload-${index}`, index]).flat());
for (const receiver of receivers) assert.equal(receiver.length, 0, 'scratch must release bound values after each run');

// A throwing binder must also release partial references; later calls must work.
let fail = true;
const errorReceivers = new Set();
const failing = createMultiRowInserter({ prepare: () => ({ run: () => {
  if (fail) throw new Error('injected bind failure');
} }) }, { table: 'items', columns: ['id', 'value'], maxRows: 2 });
Array.prototype.push = function(...values) {
  if (values[0] === 'scratch-payload-error') errorReceivers.add(this);
  return originalPush.apply(this, values);
};
try {
  assert.throws(() => failing([['scratch-payload-error', Buffer.from('owned')]]), /injected bind failure/);
  fail = false;
  failing([['scratch-payload-error', 3]]);
  assert.throws(() => failing([['scratch-payload-error', 3], ['bad-shape']]), /row shape mismatch/);
} finally {
  Array.prototype.push = originalPush;
}
for (const receiver of errorReceivers) assert.equal(receiver.length, 0);

const recursiveRuns = [];
let entered = false;
let recursiveInsert;
recursiveInsert = createMultiRowInserter({ prepare: () => ({ run: (...values) => {
  recursiveRuns.push(values);
  if (!entered) {
    entered = true;
    recursiveInsert([['inner', 7]]);
  }
} }) }, { table: 'items', columns: ['id', 'value'], maxRows: 2 });
recursiveInsert([['outer-a', 1], ['outer-b', 2], ['outer-c', 3]]);
assert.deepEqual(recursiveRuns, [['outer-a', 1, 'outer-b', 2], ['inner', 7], ['outer-c', 3]],
  'recursive calls must own separate parameter scratch');

// Real native database checks: variable-limit boundaries, short batches, value
// types, dedupe, prepared statement reuse and caller-owned transaction rollback.
const db = new Database(':memory:');
try {
  db.exec('CREATE TABLE values_test (id TEXT PRIMARY KEY, amount REAL, bytes BLOB, optional TEXT)');
  const stats = {};
  const realInsert = createMultiRowInserter(db, {
    table: 'values_test', columns: ['id', 'amount', 'bytes', 'optional'],
    maxVariables: 9, maxRows: 100, stats
  });
  assert.equal(realInsert.maxRows, 2);
  const rows = Array.from({ length: 5 }, (_, index) => [
    `row-${index}`, index + 0.5, Buffer.from([index, 0, 255]), index % 2 ? 'emoji 😀' : null
  ]);
  db.transaction(() => realInsert(rows))();
  assert.deepEqual(db.prepare('SELECT id, amount, bytes, optional FROM values_test ORDER BY id').raw().all(), rows);
  assert.equal(realInsert.getPreparedCount(), 2);
  assert.equal(stats.multiRow.values_test.runs, 3);
  assert.equal(stats.multiRow.values_test.rows, 5);

  const before = db.prepare('SELECT * FROM values_test ORDER BY id').all();
  assert.throws(db.transaction(() => realInsert([
    ['fresh-a', 1, null, null], ['fresh-b', 2, null, null],
    ['row-0', 3, null, null], ['fresh-c', 4, null, null]
  ])), /UNIQUE constraint failed/);
  assert.deepEqual(db.prepare('SELECT * FROM values_test ORDER BY id').all(), before);
  assert.throws(db.transaction(() => realInsert([
    ['fresh-a', 1, null, null], ['fresh-b', 2, null, null], ['bad-shape']
  ])), /row shape mismatch/);
  assert.deepEqual(db.prepare('SELECT * FROM values_test ORDER BY id').all(), before);
  realInsert([['after-failure', 9, Buffer.from('ok'), 'recovered']]);
  assert.equal(db.prepare('SELECT amount FROM values_test WHERE id = ?').get('after-failure').amount, 9);
  assert.equal(realInsert.getPreparedCount(), 2, 'failed and short runs retain statement-cache behavior');

  db.exec('CREATE TABLE postings (token TEXT, doc INTEGER, frequency REAL, PRIMARY KEY (token, doc))');
  const dedupeStats = {};
  const dedupe = createMultiRowInserter(db, {
    table: 'postings', columns: ['token', 'doc', 'frequency'], maxVariables: 7,
    dedupeKeyIndices: [0, 1], dedupeSumIndex: 2, stats: dedupeStats
  });
  const duplicateRows = [['a', 1, 2], ['a', 1, 3], ['b', 2, '4'], ['b', 2, null], ['c', 3, 5]];
  const saved = structuredClone(duplicateRows);
  db.transaction(() => dedupe(duplicateRows))();
  assert.deepEqual(db.prepare('SELECT * FROM postings ORDER BY token').raw().all(), [['a', 1, 5], ['b', 2, 4], ['c', 3, 5]]);
  assert.deepEqual(duplicateRows, saved, 'dedupe must not mutate caller rows');
  assert.equal(dedupeStats.multiRow.postings.inputRows, 5);
  assert.equal(dedupeStats.multiRow.postings.dedupedRows, 2);
  assert.equal(dedupe.getPreparedCount(), 2);

  // The pre-existing spread convention permits top-level bind arrays. Do not
  // change that behavior by passing a newly nested params array to stmt.run.
  db.exec('CREATE TABLE array_binding (value TEXT)');
  const arrayInsert = createMultiRowInserter(db, { table: 'array_binding', columns: ['value'] });
  arrayInsert([[['expanded']]]);
  assert.equal(db.prepare('SELECT value FROM array_binding').get().value, 'expanded');
} finally {
  db.close();
}
console.log('native SQLite multi-row scratch, value, dedupe, statement-cache and rollback contracts passed');
