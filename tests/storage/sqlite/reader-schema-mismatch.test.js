#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(ROOT, 'sqlite-reader-schema-mismatch');
const dbPath = path.join(tempRoot, 'index-code.db');
const goodPath = path.join(tempRoot, 'valid.db');
const otherGoodPath = path.join(tempRoot, 'other-valid.db');
const missingTablesPath = path.join(tempRoot, 'missing-tables.db');
const missingColumnsPath = path.join(tempRoot, 'missing-columns.db');

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite reader tests.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

for (const filePath of [dbPath, goodPath, otherGoodPath, missingTablesPath, missingColumnsPath]) {
  const writer = new Database(filePath);
  try {
    if (filePath !== missingTablesPath) writer.exec(CREATE_TABLES_BASE_SQL);
    writer.pragma(`user_version = ${filePath === dbPath ? Math.max(0, SCHEMA_VERSION - 1) : SCHEMA_VERSION}`);
    if (filePath === missingColumnsPath) {
      writer.exec('ALTER TABLE chunks RENAME COLUMN churn_added TO obsolete_churn_added');
    }
  } finally {
    writer.close();
  }
}

const baseOptions = {
  useSqlite: true,
  needsCode: true,
  needsProse: false,
  sqliteCodePath: dbPath,
  sqliteProsePath: null,
  sqliteFtsRequested: false,
  backendForcedSqlite: true,
  vectorExtension: { table: 'dense_vectors_ann' },
  vectorAnnEnabled: false,
  dbCache: null,
  sqliteStates: {}
};
const cache = createSqliteDbCache();
const backends = new Set();
const openBackend = async (overrides = {}) => {
  const backend = await createSqliteBackend({ ...baseOptions, ...overrides });
  backends.add(backend);
  return backend;
};
const handles = new Set();
const closeCounts = new Map();
const originalPrepare = Database.prototype.prepare;
const originalPragma = Database.prototype.pragma;
const originalClose = Database.prototype.close;
let injectFailure = null;
let failClosePath = null;
const observe = (db) => {
  if (db.readonly) handles.add(db);
};
Database.prototype.prepare = function (...args) {
  observe(this);
  injectFailure?.(this, 'prepare', args[0]);
  return originalPrepare.apply(this, args);
};
Database.prototype.pragma = function (...args) {
  observe(this);
  injectFailure?.(this, 'pragma', args[0]);
  return originalPragma.apply(this, args);
};
Database.prototype.close = function (...args) {
  if (this.readonly) closeCounts.set(this, (closeCounts.get(this) || 0) + 1);
  const result = originalClose.apply(this, args);
  if (this.name === failClosePath) throw new Error('injected close failure');
  return result;
};
const assertClosedSince = (before, count) => {
  const opened = [...handles].filter((db) => !before.has(db));
  assert.equal(opened.length, count, 'expected to observe every opened reader handle');
  for (const db of opened) {
    assert.equal(db.open, false, 'initialization failure must close every unpublished handle');
    assert.equal(closeCounts.get(db), 1, 'a physical handle must be closed exactly once');
  }
};

try {
  for (const [sqliteCodePath, pattern] of [
    [dbPath, /schema mismatch/],
    [missingTablesPath, /missing required tables/],
    [missingColumnsPath, /missing required columns/]
  ]) {
    let before = new Set(handles);
    await assert.rejects(openBackend({ sqliteCodePath }), pattern);
    assertClosedSince(before, 1);
    before = new Set(handles);
    const fallback = await openBackend({ sqliteCodePath, backendForcedSqlite: false });
    assert.equal(fallback.useSqlite, false);
    assert.equal(fallback.dbCode, null);
    await fallback.dispose();
    await fallback.dispose();
    assertClosedSince(before, 1);
  }

  for (const [method, sql, label] of [
    ['prepare', "SELECT name FROM sqlite_master WHERE type='table'", 'table probe'],
    ['prepare', 'PRAGMA table_info(chunks)', 'column probe'],
    ['pragma', 'user_version', 'schema pragma']
  ]) {
    const before = new Set(handles);
    injectFailure = (db, calledMethod, statement) => {
      if (db.name === otherGoodPath && calledMethod === method && statement === sql) {
        throw new Error(`injected ${label} failure`);
      }
    };
    await assert.rejects(openBackend({
      sqliteCodePath: goodPath,
      sqliteProsePath: otherGoodPath,
      needsProse: true
    }), new RegExp(`injected ${label} failure`));
    injectFailure = null;
    assertClosedSince(before, 2);
  }

  let before = new Set(handles);
  await assert.rejects(openBackend({
    sqliteCodePath: goodPath,
    sqliteReadPragmas: { get tailLatencyTuning() { throw new Error('injected pragma options failure'); } }
  }), /injected pragma options failure/);
  assertClosedSince(before, 1);

  before = new Set(handles);
  await assert.rejects(openBackend({
    sqliteCodePath: goodPath,
    sqliteProsePath: otherGoodPath,
    needsProse: true,
    vectorAnnEnabled: true,
    vectorExtension: {
      table: 'dense_vectors_ann',
      get enabled() { throw new Error('injected ANN initialization failure'); }
    }
  }), /injected ANN initialization failure/);
  assertClosedSince(before, 2);

  before = new Set(handles);
  injectFailure = (db, method) => {
    if (db.name === otherGoodPath && method === 'prepare') throw new Error('primary schema probe failure');
  };
  failClosePath = goodPath;
  await assert.rejects(openBackend({
    sqliteCodePath: goodPath,
    sqliteProsePath: otherGoodPath,
    needsProse: true
  }), /primary schema probe failure/);
  injectFailure = null;
  failClosePath = null;
  assertClosedSince(before, 2);

  const warm = await openBackend({ sqliteCodePath: goodPath, sqliteProsePath: dbPath, dbCache: cache });
  await assert.rejects(openBackend({
    sqliteCodePath: goodPath,
    sqliteProsePath: dbPath,
    needsProse: true,
    dbCache: cache
  }), /schema mismatch/);
  cache.closeAll();
  assert.equal(warm.dbCode.open, true, 'a forced failure must not close another live request');
  await warm.dispose();
  assert.equal(warm.dbCode.open, false, 'forced initialization failure must release its earlier cached lease');

  const old = await openBackend({ sqliteCodePath: goodPath, sqliteProsePath: dbPath, dbCache: cache });
  const replacementDb = new Database(goodPath, { readonly: true });
  observe(replacementDb);
  let replacementLease = null;
  const replacingCache = {
    acquire(filePath, options) {
      if (filePath === dbPath && !replacementLease) {
        replacementLease = cache.setAndAcquire(goodPath, replacementDb);
      }
      return cache.acquire(filePath, options);
    },
    setAndAcquire: cache.setAndAcquire,
    close: cache.close
  };
  const staleFallback = await openBackend({
    sqliteCodePath: goodPath,
    sqliteProsePath: dbPath,
    needsProse: true,
    backendForcedSqlite: false,
    dbCache: replacingCache
  });
  assert.equal(staleFallback.useSqlite, false);
  assert.equal(cache.get(goodPath), replacementDb, 'stale fallback must not invalidate a newer handle');
  await old.dispose();
  assert.equal(old.dbCode.open, false);
  assert.equal(replacementDb.open, true);
  replacementLease.release();
  cache.closeAll();
  assert.equal(replacementDb.open, false);

  for (const replaceDuringFallback of [false, true]) {
    const legacyCache = new Map();
    const legacyWarm = await openBackend({
      sqliteCodePath: goodPath,
      sqliteProsePath: dbPath,
      dbCache: legacyCache
    });
    await legacyWarm.dispose();
    let newer = null;
    if (replaceDuringFallback) {
      const originalGet = legacyCache.get.bind(legacyCache);
      legacyCache.get = (filePath) => {
        if (filePath === dbPath && !newer) {
          newer = new Database(goodPath, { readonly: true });
          observe(newer);
          legacyCache.set(goodPath, newer);
        }
        return originalGet(filePath);
      };
    }
    const legacyFallback = await openBackend({
      sqliteCodePath: goodPath,
      sqliteProsePath: dbPath,
      needsProse: true,
      backendForcedSqlite: false,
      dbCache: legacyCache
    });
    assert.equal(legacyFallback.useSqlite, false);
    assert.equal(legacyWarm.dbCode.open, false);
    if (replaceDuringFallback) {
      assert.equal(legacyCache.get(goodPath), newer, 'Map fallback must preserve replacement entries');
      assert.equal(newer.open, true);
      newer.close();
    } else {
      assert.equal(legacyCache.has(goodPath), false, 'Map fallback must not leave a closed handle discoverable');
    }
  }

  for (const options of [
    { useSqlite: false },
    { backendForcedSqlite: false, sqliteStates: { code: { sqlite: { pending: true } } } }
  ]) {
    const inactive = await openBackend(options);
    assert.equal(inactive.useSqlite, false);
    await inactive.dispose();
    await inactive.dispose();
  }
} finally {
  injectFailure = null;
  failClosePath = null;
  Database.prototype.prepare = originalPrepare;
  Database.prototype.pragma = originalPragma;
  Database.prototype.close = originalClose;
  for (const backend of backends) await backend.dispose();
  cache.dispose();
  for (const db of handles) {
    if (db.open) originalClose.call(db);
  }
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('SQLite reader fail-closed and request cleanup ok.');
