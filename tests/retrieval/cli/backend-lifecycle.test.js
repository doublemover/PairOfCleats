#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { open, allDbs } from 'lmdb';
import { Packr } from 'msgpackr';
import { createLmdbBackend } from '../../../src/retrieval/cli-lmdb.js';
import { createBackendContext } from '../../../src/retrieval/cli/backend-context.js';
import { createBackendContextWithTracking } from '../../../src/retrieval/cli/run-search/backend-context.js';
import { createBackendDisposer } from '../../../src/retrieval/cli/backend-disposal.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const tick = () => new Promise((resolve) => setImmediate(resolve));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-backend-lifecycle-'));
const packr = new Packr();
const codePath = path.join(temp, `code-${process.pid}`);
const prosePath = path.join(temp, `prose-${process.pid}`);
const invalidPath = path.join(temp, `invalid-${process.pid}`);
const corruptPath = path.join(temp, `corrupt-${process.pid}`);
const sqlitePath = path.join(temp, 'index.db');
const invalidSqlitePath = path.join(temp, 'invalid.db');
const liveDisposers = new Set();
const originalClose = Database.prototype.close;
let releaseClose = null;

const writeStore = async (storePath, mode, version = LMDB_SCHEMA_VERSION, corrupt = false) => {
  const db = open({ path: storePath, mapSize: 1024 * 1024 });
  try {
    db.putSync(LMDB_META_KEYS.schemaVersion, corrupt ? Buffer.from([0xc1]) : packr.pack(version));
    db.putSync(LMDB_META_KEYS.mode, packr.pack(mode));
  } finally {
    await db.close();
  }
};
const lastStore = (storePath) => allDbs.get(path.basename(storePath));
const lmdbOptions = {
  useLmdb: true, needsCode: true, needsProse: true,
  lmdbCodePath: codePath, lmdbProsePath: prosePath, backendForcedLmdb: true
};
const contextOptions = {
  ...lmdbOptions,
  useSqlite: true, sqliteCodePath: sqlitePath, needsProse: false,
  backendForcedSqlite: true, sqliteFtsRequested: false, vectorAnnEnabled: false,
  postingsConfig: {}, root: temp, userConfig: { cache: { root: path.join(temp, 'cache') } }
};

try {
  await writeStore(codePath, 'code');
  await writeStore(prosePath, 'prose');
  await writeStore(invalidPath, 'prose', LMDB_SCHEMA_VERSION + 1);
  await writeStore(corruptPath, 'prose', LMDB_SCHEMA_VERSION, true);
  const writer = new Database(sqlitePath);
  writer.exec(CREATE_TABLES_SQL);
  writer.pragma(`user_version = ${SCHEMA_VERSION}`);
  writer.close();
  new Database(invalidSqlitePath).close();

  const cleanupCalls = [];
  let release;
  const dispose = createBackendDisposer(new Set([
    () => new Promise((resolve) => { release = () => { cleanupCalls.push('async'); resolve(); }; }),
    () => { cleanupCalls.push('throw'); throw new Error('expected cleanup failure'); },
    () => cleanupCalls.push('last')
  ]));
  const cleanupResult = dispose();
  assert.equal(dispose(), cleanupResult, 'cleanup must return its original Promise');
  await tick();
  assert.deepEqual(cleanupCalls, [], 'cleanup must await asynchronous release');
  release();
  await assert.rejects(cleanupResult, AggregateError);
  assert.deepEqual(cleanupCalls, ['async', 'throw', 'last'], 'every resource must receive one close attempt');

  const lmdb = await createLmdbBackend(lmdbOptions);
  liveDisposers.add(lmdb.dispose);
  assert.equal(lmdb.useLmdb, true);
  const closeCode = lmdb.dbCode.close.bind(lmdb.dbCode);
  lmdb.dbCode.close = async () => {
    await new Promise((resolve) => { releaseClose = resolve; });
    await closeCode();
  };
  let settled = false;
  const closing = lmdb.dispose().then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'LMDB disposal must await close completion');
  releaseClose();
  releaseClose = null;
  await closing;
  await lmdb.dispose();
  assert.equal(lmdb.dbCode.status, 'closed');
  assert.equal(lmdb.dbProse.status, 'closed');

  for (const failingPath of [invalidPath, corruptPath]) {
    await assert.rejects(createLmdbBackend({ ...lmdbOptions, lmdbProsePath: failingPath }));
    assert.equal(lastStore(codePath).status, 'closed', 'a previous valid store must close on later failure');
    assert.equal(lastStore(failingPath).status, 'closed', 'an invalid or undecodable store must close');
  }
  const fallback = await createLmdbBackend({
    ...lmdbOptions, lmdbProsePath: invalidPath, backendForcedLmdb: false
  });
  assert.equal(fallback.useLmdb, false);
  await fallback.dispose();
  assert.equal(lastStore(codePath).status, 'closed');

  const context = await createBackendContext(contextOptions);
  liveDisposers.add(context.dispose);
  assert.equal(context.useSqlite, true);
  assert.equal(context.lmdbCode, null);
  assert.equal(lastStore(codePath).status, 'closed', 'SQLite selection must close the discarded LMDB backend');
  const sqlite = context.dbCode;
  assert.equal(sqlite.open, true);
  await context.dispose();
  await context.dispose();
  assert.equal(sqlite.open, false, 'uncached SQLite must close at context disposal');

  await assert.rejects(createBackendContext({ ...contextOptions, sqliteCodePath: invalidSqlitePath }));
  assert.equal(lastStore(codePath).status, 'closed', 'SQLite initialization failure must release earlier LMDB stores');

  const closed = [];
  Database.prototype.close = function (...args) {
    if (this.name === sqlitePath) closed.push(this);
    return originalClose.apply(this, args);
  };
  const helperFailure = new Error('helper construction failed');
  await assert.rejects(createBackendContext({
    ...contextOptions,
    postingsConfig: { get chargramMaxTokenLength() { throw helperFailure; } }
  }), (error) => error === helperFailure);
  assert.equal(closed.length, 1, 'helper construction failure must dispose the SQLite handle');
  assert.equal(closed[0].open, false);

  const trackingFailure = new Error('stage tracking failed');
  await assert.rejects(createBackendContextWithTracking({
    contextInput: contextOptions,
    stageTracker: { mark: () => 0, record: () => { throw trackingFailure; } }
  }), (error) => error === trackingFailure);
  assert.equal(closed.length, 2, 'tracking failure must dispose a successfully constructed context');
  assert.equal(closed[1].open, false);
} finally {
  releaseClose?.();
  Database.prototype.close = originalClose;
  for (const dispose of liveDisposers) {
    try { await dispose(); } catch {}
  }
  for (const storePath of [codePath, prosePath, invalidPath, corruptPath]) {
    const db = lastStore(storePath);
    if (db && db.status !== 'closed') await db.close();
  }
  await fs.rm(temp, { recursive: true, force: true });
}

console.log('search backend lifecycle test passed');
