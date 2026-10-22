#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { checkpointSqliteWithTelemetry, replaceSqliteDatabase } from '../../../src/storage/sqlite/utils.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-wal-publication-'));
const read = file => { const db = new Database(file); try { return db.prepare('SELECT value FROM witness ORDER BY value').all().map(row => row.value); } finally { db.close(); } };
try {
  for (const promote of [false, true]) {
    const final = path.join(root, `old-${promote}.db`), staged = path.join(root, `new-${promote}.db`);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const db = new Database(${JSON.stringify(final)});
      db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
      db.exec("CREATE TABLE witness(value TEXT); INSERT INTO witness VALUES ('committed-old')");
      process.exit(0);
    `], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    assert.ok((await fs.stat(`${final}-wal`)).size > 0);
    const next = new Database(staged); next.exec("CREATE TABLE witness(value TEXT); INSERT INTO witness VALUES ('new')"); next.close();
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (!promote && from === staged && to === final) throw Object.assign(new Error('promotion failed'), { code: 'EIO' });
      return rename(from, to);
    };
    try {
      const operation = replaceSqliteDatabase(staged, final, { keepBackup: true });
      if (promote) await operation;
      else await assert.rejects(operation, { code: 'EIO' });
    } finally { fs.rename = rename; }
    assert.deepEqual(read(final), [promote ? 'new' : 'committed-old']);
    assert.deepEqual(read(`${final}.bak`), ['committed-old']);
  }
  for (const failure of ['skip', 'initialization']) {
    const file = path.join(root, `incremental-${failure}.db`);
    const writer = new Database(file, { timeout: 0 });
    writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
    writer.exec("CREATE TABLE witness(value TEXT); INSERT INTO witness VALUES ('base')");
    writer.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(writer);
    writer.pragma('wal_checkpoint(TRUNCATE)');
    const reader = new Database(file, { timeout: 0 }); reader.exec('BEGIN'); reader.prepare('SELECT * FROM witness').all();
    writer.exec("INSERT INTO witness VALUES ('committed')");
    assert.throws(() => checkpointSqliteWithTelemetry(writer, { dbPath: file }), { code: 'ERR_SQLITE_CHECKPOINT_BUSY' });
    function ProbeDatabase(target) {
      const db = new Database(target, { timeout: 0 });
      const pragma = db.pragma.bind(db);
      db.pragma = (sql, ...args) => {
        if (failure === 'initialization' && sql === 'page_size') throw new Error('initialization failure');
        return pragma(sql, ...args);
      };
      return db;
    }
    try {
      const operation = incrementalUpdateDatabase({ Database: ProbeDatabase, outPath: file, mode: 'code',
        incrementalData: { manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION } },
        modelConfig: {}, vectorConfig: {}, buildPragmas: false });
      if (failure === 'skip') assert.equal((await operation).used, false);
      else await assert.rejects(operation, /initialization failure/);
      assert.deepEqual(read(file), ['base', 'committed'], 'busy finalizer preserves committed WAL rows');
    } finally { reader.exec('ROLLBACK'); reader.close(); writer.close(); }
  }
  const final = path.join(root, 'orphan-final.db'), staged = path.join(root, 'orphan-staged.db');
  await fs.writeFile(final, 'old authority'); await fs.writeFile(staged, 'replacement');
  await fs.writeFile(`${final}.bak-wal`, 'orphaned recovery frames');
  await assert.rejects(replaceSqliteDatabase(staged, final), { code: 'ERR_SQLITE_RECOVERY_REQUIRED' });
  assert.equal(await fs.readFile(final, 'utf8'), 'old authority');
  assert.equal(await fs.readFile(staged, 'utf8'), 'replacement');
  assert.equal(await fs.readFile(`${final}.bak-wal`, 'utf8'), 'orphaned recovery frames');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('SQLite WAL authority survives replacement rollback, backup, and incremental early exits');
