import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode as runNodeFixture } from '../../../helpers/run-node.js';
import Database from 'better-sqlite3';
import { closeSqliteBuildDatabase } from '../../../../src/storage/sqlite/build/core.js';

// UNRUN: exercise the actual fallback finalizer, not a replacement-helper copy.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sqlite-fallback-wal-'));
const read = file => {
  const db = new Database(file);
  try { return db.prepare('SELECT value FROM witness ORDER BY value').all().map(row => row.value); }
  finally { db.close(); }
};
const create = (file, value) => {
  const db = new Database(file, { timeout: 0 });
  db.exec('CREATE TABLE witness(value TEXT)');
  db.prepare('INSERT INTO witness VALUES (?)').run(value);
  return db;
};
try {
  for (const outcome of ['success', 'failure', 'cancelled']) {
    const final = path.join(root, `${outcome}-final.db`);
    const staged = path.join(root, `${outcome}-short-staged.db`);
    const child = runNodeFixture(['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const db = new Database(${JSON.stringify(final)});
      db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
      db.exec("CREATE TABLE witness(value TEXT); INSERT INTO witness VALUES ('committed-old')");
      process.exit(0);
    `], 'isolated Node fixture', process.cwd(), process.env, { allowFailure: true, spawnOptions: { cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 5000 } });
    assert.equal(child.status, 0, child.stderr);
    assert.ok((await fs.stat(`${final}-wal`)).size > 0);
    const db = create(staged, 'replacement');
    const controller = new AbortController();
    const rename = fs.rename;
    let closes = 0;
    const close = db.close.bind(db);
    db.close = () => { closes++; return close(); };
    fs.rename = async (from, to) => {
      if (outcome === 'failure' && from === staged && to === final) {
        throw Object.assign(new Error('controlled fallback promotion failure'), { code: 'EIO' });
      }
      const result = await rename(from, to);
      if (outcome === 'cancelled' && from === final && to === `${final}.bak`) controller.abort();
      return result;
    };
    try {
      const operation = closeSqliteBuildDatabase({ db, succeeded: true, outPath: final,
        dbPath: staged, promotePath: final, signal: controller.signal });
      if (outcome === 'success') await operation;
      else await assert.rejects(operation, { code: outcome === 'failure' ? 'EIO' : 'ABORT_ERR' });
    } finally { fs.rename = rename; if (db.open) close(); }
    assert.equal(closes, 1);
    assert.deepEqual(read(final), [outcome === 'success' ? 'replacement' : 'committed-old']);
    if (outcome !== 'success') assert.deepEqual(read(staged), ['replacement'], 'failed publication retains the complete staged authority for recovery');
  }

  for (const pinned of ['final', 'staged']) {
    const final = path.join(root, `busy-${pinned}-final.db`);
    const staged = path.join(root, `busy-${pinned}-staged.db`);
    const old = create(final, 'old');
    old.close();
    let db;
    let writer;
    let reader;
    try {
      const pinnedPath = pinned === 'final' ? final : staged;
      writer = pinned === 'final' ? new Database(final, { timeout: 0 }) : create(staged, 'staged-base');
      writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
      writer.pragma('wal_checkpoint(TRUNCATE)');
      reader = new Database(pinnedPath, { timeout: 0 });
      reader.exec('BEGIN'); reader.prepare('SELECT * FROM witness').all();
      writer.prepare('INSERT INTO witness VALUES (?)').run('wal-committed');
      db = pinned === 'staged' ? writer : create(staged, 'replacement');
      await assert.rejects(closeSqliteBuildDatabase({ db, succeeded: true, outPath: final,
        dbPath: staged, promotePath: final }), { code: 'ERR_SQLITE_CHECKPOINT_BUSY' });
      assert.equal(db.open, false);
      assert.ok((await fs.stat(`${pinnedPath}-wal`)).size > 0, 'a blocked checkpoint cannot authorize sidecar removal');
      assert.deepEqual(read(final), pinned === 'final' ? ['old', 'wal-committed'] : ['old']);
      reader.exec('ROLLBACK'); reader.close(); reader = null;
      if (writer.open) writer.close();
      assert.deepEqual(read(staged), pinned === 'staged' ? ['staged-base', 'wal-committed'] : ['replacement']);
    } finally {
      if (reader?.open) { reader.exec('ROLLBACK'); reader.close(); }
      if (writer?.open) writer.close();
      if (db?.open) db.close();
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Fallback SQLite publication preserves committed final and staging WAL state across failure, cancellation, and busy checkpoints.');
