import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { getPendingSqliteCacheOwners } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('sqlite-uncached-close-ownership/')[1];
assert.ok(['sticky-failure', 'native-observation', 'explicit-false', 'initialization-failure'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-uncached-owner-${selected}`);
const codePath = path.join(dir, 'code.db'), prosePath = path.join(dir, 'prose.db');
const originalClose = Database.prototype.close, handles = new Set(), calls = new Map();
for (const [file, mode] of [[codePath, 'code'], [prosePath, 'prose']]) {
  const writer = new Database(file);
  try {
    if (selected === 'initialization-failure' && mode === 'code') continue;
    writer.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(writer); writer.pragma(`user_version = ${SCHEMA_VERSION}`);
    writer.prepare('INSERT INTO chunks (id, chunk_id, mode, file) VALUES (?, ?, ?, ?)').run(1, `chunk-${mode}`, mode, `${mode}.js`);
  } finally { originalClose.call(writer); }
}
let deny = true, originalSettled = false, observerReads = 0;
let reportedObserver = () => originalSettled;
const nativeFailure = Object.assign(new Error('controlled original uncached close failure'), { code: 'EIO' });
if (selected === 'native-observation') Object.defineProperties(nativeFailure, {
  cacheOwnershipPending: { value: true },
  cacheOwnershipReleased: { get() { observerReads += 1; return reportedObserver; } }
});
Object.freeze(nativeFailure);
Database.prototype.close = function () {
  handles.add(this); calls.set(this, (calls.get(this) || 0) + 1);
  if (this.name === codePath && deny) {
    if (selected === 'explicit-false') return false;
    throw nativeFailure;
  }
  return originalClose.call(this);
};
const contains = (root, expected) => {
  const queue = [root], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); queue.push(value.cause, ...(value instanceof AggregateError ? value.errors : []));
  }
  return false;
};
let backend;
try {
  const options = { useSqlite: true, needsCode: true, needsProse: selected === 'sticky-failure', needsExtractedProse: false,
    sqliteCodePath: codePath, sqliteProsePath: prosePath, sqliteFtsRequested: false, backendForcedSqlite: true,
    vectorExtension: {}, vectorAnnEnabled: false };
  let failure;
  if (selected === 'initialization-failure') {
    await assert.rejects(createSqliteBackend(options), error => { failure = error; return true; });
    assert.equal(failure.cause?.code, 'ERR_INDEX_FORMAT_UNSUPPORTED', 'initialization failure stays primary');
  } else {
    backend = await createSqliteBackend(options);
    assert.equal(backend.dbCode.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
    assert.throws(() => backend.dispose(), error => { failure = error; return true; });
    assert.throws(() => backend.dispose(), error => error === failure, 'repeated dispose retains the exact failed outcome');
  }
  assert.equal(failure.cacheOwnershipReleased(), false, 'unconfirmed native close retains cleanup authority');
  const code = [...handles].find(db => db.name === codePath); assert.ok(code); assert.equal(code.open, true);
  assert.equal(calls.get(code), 1, 'ordinary disposal never retries the native close');
  if (selected !== 'explicit-false') assert.equal(contains(failure, nativeFailure), true);
  if (selected === 'sticky-failure') {
    const prose = [...handles].find(db => db.name === prosePath); assert.ok(prose);
    assert.equal(prose.open, false); assert.equal(calls.get(prose), 1, 'independent handles still close after a sibling fails');
  }
  const owner = getPendingSqliteCacheOwners().find(candidate => candidate.db === code); assert.ok(owner);
  if (selected === 'native-observation') {
    reportedObserver = () => true;
    assert.throws(() => owner.release(), 'replacing the report callback cannot settle the original native observation');
    assert.equal(calls.get(code), 1); assert.equal(observerReads, 1);
  }
  deny = false; originalSettled = true;
  assert.equal(owner.release().settled, true, 'explicit reconciliation uses the original close owner');
  assert.equal(code.open, false); assert.equal(failure.cacheOwnershipReleased(), true);
  if (backend) assert.throws(() => backend.dispose(), error => error === failure, 'reconciliation preserves the original failed outcome');
  assert.equal(calls.get(code), 2);
} finally {
  deny = false; originalSettled = true;
  for (const owner of getPendingSqliteCacheOwners()) if ([codePath, prosePath].includes(owner.db?.name)) owner.release();
  Database.prototype.close = originalClose;
  for (const db of handles) if (db.open) originalClose.call(db);
}
console.log(`Uncached SQLite ${selected} preserves native ownership and original disposal outcomes.`);
