#!/usr/bin/env node
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import assert from 'node:assert/strict';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('sqlite-incremental-handle-lifecycle');
const manifestEntry = { bundles: ['unused.json'], hash: 'current', mtimeMs: 123, size: 10 };

const runCase = async ({ name, failureAt = null, baselineHash = null, schemaVersion = SCHEMA_VERSION,
  missingTable = false, closeFailure = false, checkpointFailure = false, buildPragmas = false }) => {
  const outPath = path.join(tempRoot, `${name}.db`);
  const writer = new Database(outPath);
  try {
    writer.exec(CREATE_TABLES_BASE_SQL);
    writer.pragma(`user_version = ${schemaVersion}`);
    writeSqliteIndexFormat(writer);
    writer.prepare(
      'INSERT INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('code', 'sample.js', baselineHash, 123, 10, 0);
    if (missingTable) writer.exec('DROP TABLE dense_vectors');
  } finally {
    writer.close();
  }

  const failure = new Error(`injected ${failureAt} failure`);
  const handles = [];
  const closeCounts = new Map();
  let failureInjected = false;
  let rollbackObserved = false;
  let checkpointAttempts = 0;
  let manifestWrites = 0;
  const pragmaCalls = [];
  const inject = (stage) => {
    if (stage !== failureAt) return;
    failureInjected = true;
    throw failure;
  };
  function TrackingDatabase(filePath) {
    const db = new Database(filePath);
    handles.push(db);
    const pragma = db.pragma.bind(db);
    const prepare = db.prepare.bind(db);
    const transaction = db.transaction.bind(db);
    const close = db.close.bind(db);
    db.pragma = (sql, ...args) => {
      pragmaCalls.push(sql);
      if (sql === 'page_size') inject('pragma');
      if (sql.startsWith('wal_checkpoint(')) {
        checkpointAttempts += 1;
        if (checkpointFailure) throw new Error('injected checkpoint failure');
      }
      return pragma(sql, ...args);
    };
    db.prepare = (sql, ...args) => {
      if (sql === "SELECT name FROM sqlite_master WHERE type='table'") inject('schema');
      if (sql.startsWith('SELECT file, hash, mtimeMs, size FROM file_manifest')) inject('planner');
      const statement = prepare(sql, ...args);
      if (sql.startsWith('UPDATE file_manifest SET hash')) {
        const run = statement.run.bind(statement);
        statement.run = (...values) => {
          manifestWrites += 1;
          const result = run(...values);
          // Fail after a real write inside the existing transaction to prove
          // that lifecycle cleanup does not change rollback semantics.
          inject('manifest-only');
          return result;
        };
      }
      return statement;
    };
    db.transaction = (fn) => {
      const apply = transaction(fn);
      return (...args) => {
        try {
          return apply(...args);
        } catch (error) {
          rollbackObserved = !db.inTransaction;
          throw error;
        }
      };
    };
    db.close = () => {
      closeCounts.set(db, (closeCounts.get(db) || 0) + 1);
      close();
      if (closeFailure) throw new Error('injected close failure');
    };
    return db;
  }

  let result;
  try {
    const update = incrementalUpdateDatabase({
      Database: TrackingDatabase,
      outPath,
      mode: 'code',
      incrementalData: { manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { 'sample.js': manifestEntry } }, bundleDir: tempRoot },
      modelConfig: { id: null },
      vectorConfig: {},
      emitOutput: false,
      validateMode: 'off',
      expectedDense: null,
      buildPragmas
    });
    if (failureAt) {
      await assert.rejects(update, (error) => error === failure, `${name}: preserve the original failure`);
      assert.equal(failureInjected, true, `${name}: failure injection must be reached`);
    } else if (schemaVersion !== SCHEMA_VERSION) {
      await assert.rejects(update, { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
    } else {
      result = await update;
    }
    assert.equal(handles.length, 1, `${name}: exactly one owned database`);
    assert.equal(closeCounts.get(handles[0]), 1, `${name}: close owned handle exactly once`);
    assert.equal(handles[0].open, false, `${name}: no retained open database`);
    assert.equal(checkpointAttempts >= 1, schemaVersion === SCHEMA_VERSION,
      `${name}: only admitted databases reach checkpoint finalization`);
    if (buildPragmas) {
      const applied = pragmaCalls.indexOf('locking_mode = EXCLUSIVE');
      const restored = pragmaCalls.indexOf('locking_mode = normal');
      assert.ok(applied >= 0 && restored > applied, `${name}: restore the captured lock mode before close`);
    }
    if (failureAt === 'manifest-only') {
      assert.equal(manifestWrites, 1, 'failure must happen after the real manifest write');
      assert.equal(rollbackObserved, true, 'transaction must roll back before cleanup');
    }
    const reader = new Database(outPath, { readonly: true });
    try {
      const row = reader.prepare('SELECT hash FROM file_manifest WHERE file = ?').get('sample.js');
      assert.equal(row.hash, !failureAt && result?.used ? 'current' : baselineHash,
        `${name}: only a successful update changes persisted manifest state`);
    } finally {
      reader.close();
    }
    return result;
  } finally {
    // A failing prefix must not leak a real handle into later test cases.
    for (const db of handles) {
      if (db.open) Database.prototype.close.call(db);
    }
  }
};

try {
  for (const failureAt of ['pragma', 'schema', 'planner', 'manifest-only']) {
    await runCase({ name: failureAt, failureAt });
  }
  await runCase({ name: 'cleanup-errors', failureAt: 'planner', checkpointFailure: true, closeFailure: true });
  await runCase({ name: 'restore-after-failure', failureAt: 'planner', buildPragmas: true });
  const manifestOnly = await runCase({ name: 'manifest-success' });
  assert.equal(manifestOnly.used, true);
  assert.equal(manifestOnly.manifestUpdates, 1);
  assert.equal(manifestOnly.insertedChunks, 0);
  const unchanged = await runCase({ name: 'unchanged', baselineHash: 'current' });
  assert.equal(unchanged.used, true);
  assert.equal(unchanged.manifestUpdates, 0);
  await runCase({ name: 'schema-mismatch', schemaVersion: SCHEMA_VERSION - 1 });
  const schemaMissing = await runCase({ name: 'schema-missing', missingTable: true });
  assert.equal(schemaMissing.used, false);
  assert.equal(schemaMissing.reason, 'schema missing');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite incremental handle lifecycle test passed');
