import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { historyError } from './common.js';

const unsafe = () => historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Inference-history storage must be a private vault outside repository trees.');

export async function openHistoryStore(vaultRoot, partitionKey, { create = false, verifyPrivateVault = null } = {}) {
  if (typeof partitionKey !== 'string' || !/^[a-f0-9]{64}$/.test(partitionKey)) throw unsafe();
  if (typeof vaultRoot !== 'string' || !path.isAbsolute(vaultRoot)) throw unsafe();
  const root = path.resolve(vaultRoot);
  // The host creates the vault deliberately. No implicit per-repo cache fallback.
  const stat = await fsPromises.lstat(root).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || await fsPromises.realpath(root) !== root) throw unsafe();
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw unsafe();
  if (process.platform === 'win32'
    && (typeof verifyPrivateVault !== 'function' || await verifyPrivateVault(root) !== true)) throw unsafe();
  const inspect = (file) => fsPromises.lstat(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  for (let directory = root; ; directory = path.dirname(directory)) {
    const control = path.join(directory, '.git');
    const entry = await inspect(control);
    if (entry && (!entry.isDirectory() || await inspect(path.join(control, 'HEAD'))
      || await inspect(path.join(control, 'config')))) throw unsafe();
    // Bare repositories have no .git child, but still contain private storage controls.
    if (await inspect(path.join(directory, 'HEAD'))
      && await inspect(path.join(directory, 'config'))
      && await inspect(path.join(directory, 'objects'))) throw unsafe();
    if (path.dirname(directory) === directory) break;
  }
  const file = path.join(root, `${partitionKey}.sqlite`);
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const entry = await fsPromises.lstat(`${file}${suffix}`).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry && (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1
      || (process.platform !== 'win32' && (entry.mode & 0o077)))) throw unsafe();
  }
  let present = await fsPromises.lstat(file).catch(() => null);
  if (!present && !create) return null;
  if (!present) {
    try {
      const handle = await fsPromises.open(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR
        | (fs.constants.O_NOFOLLOW || 0), 0o600);
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never open a raced path without reapplying all storage checks.
      return openHistoryStore(root, partitionKey, { create, verifyPrivateVault });
    }
  }
  const db = new Database(file, { timeout: 0, readonly: !create, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    if (present?.size) {
      const metadata = Object.fromEntries(db.prepare('SELECT key, value FROM vault_meta').all().map((row) => [row.key, row.value]));
      if (metadata.partition !== partitionKey || metadata.format !== 'inference-history.v4'
        || !/^[a-f0-9]{64}$/.test(metadata.reference_key || '')) throw unsafe();
    }
    if (create) {
      db.pragma('journal_mode = DELETE');
      db.pragma('secure_delete = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS vault_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, summary TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS members (
          import_id TEXT NOT NULL REFERENCES imports(id), name TEXT NOT NULL,
          kind TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT,
          PRIMARY KEY(import_id, name)
        );
        CREATE TABLE IF NOT EXISTS member_evidence (
          import_id TEXT NOT NULL REFERENCES imports(id), name TEXT NOT NULL, kind TEXT NOT NULL, raw_json TEXT NOT NULL,
          PRIMARY KEY(import_id, name)
        );
        CREATE TABLE IF NOT EXISTS member_links (
          import_id TEXT NOT NULL REFERENCES imports(id), kind TEXT NOT NULL, logical_id TEXT NOT NULL,
          path TEXT NOT NULL, declared_bytes INTEGER, state TEXT NOT NULL,
          PRIMARY KEY(import_id, kind, logical_id, path)
        );
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY, latest_snapshot TEXT, deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id),
          source_kind TEXT NOT NULL, source_id TEXT NOT NULL, raw_json TEXT NOT NULL, title TEXT NOT NULL, diagnostics TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS occurrences (
          import_id TEXT NOT NULL REFERENCES imports(id), member TEXT NOT NULL, ordinal INTEGER NOT NULL,
          snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, raw_sha256 TEXT NOT NULL,
          PRIMARY KEY(import_id, member, ordinal)
        );
        CREATE TABLE IF NOT EXISTS units (
          id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id),
          node_id TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshot_units (
          snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
          unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE, path_state TEXT NOT NULL,
          PRIMARY KEY(snapshot_id, unit_id)
        );
        CREATE INDEX IF NOT EXISTS units_record ON units(record_id);
        CREATE INDEX IF NOT EXISTS units_message ON units(json_extract(metadata,'$.messageId'), id);
        CREATE INDEX IF NOT EXISTS snapshot_units_unit ON snapshot_units(unit_id, snapshot_id);
        CREATE INDEX IF NOT EXISTS snapshots_record ON snapshots(record_id);
        CREATE INDEX IF NOT EXISTS occurrences_snapshot ON occurrences(snapshot_id, import_id, member, ordinal);

        CREATE TABLE IF NOT EXISTS history_stats (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          imports INTEGER NOT NULL, incomplete_imports INTEGER NOT NULL,
          records INTEGER NOT NULL, units INTEGER NOT NULL, unknown_dates INTEGER NOT NULL,
          first_date TEXT, last_date TEXT
        );
        INSERT OR IGNORE INTO history_stats VALUES (1, 0, 0, 0, 0, 0, NULL, NULL);
        CREATE INDEX IF NOT EXISTS units_date ON units(json_extract(metadata,'$.createdAt.utc'));
        CREATE TRIGGER IF NOT EXISTS stats_import_insert AFTER INSERT ON imports BEGIN
          UPDATE history_stats SET imports=imports+1,
            incomplete_imports=incomplete_imports+(COALESCE(json_extract(new.summary,'$.complete'),0)=0);
        END;
        CREATE TRIGGER IF NOT EXISTS stats_import_update AFTER UPDATE OF summary ON imports BEGIN
          UPDATE history_stats SET incomplete_imports=incomplete_imports
            +(COALESCE(json_extract(new.summary,'$.complete'),0)=0)
            -(COALESCE(json_extract(old.summary,'$.complete'),0)=0);
        END;
        CREATE TRIGGER IF NOT EXISTS stats_record_insert AFTER INSERT ON records BEGIN
          UPDATE history_stats SET records=records+(new.deleted=0);
        END;
        CREATE TRIGGER IF NOT EXISTS stats_record_update AFTER UPDATE OF deleted ON records BEGIN
          UPDATE history_stats SET records=records+old.deleted-new.deleted;
        END;
        CREATE TRIGGER IF NOT EXISTS stats_unit_insert AFTER INSERT ON units BEGIN
          UPDATE history_stats SET units=units+1,
            unknown_dates=unknown_dates+(json_extract(new.metadata,'$.createdAt.utc') IS NULL),
            first_date=CASE WHEN first_date IS NULL THEN json_extract(new.metadata,'$.createdAt.utc')
              WHEN json_extract(new.metadata,'$.createdAt.utc')<first_date THEN json_extract(new.metadata,'$.createdAt.utc')
              ELSE first_date END,
            last_date=CASE WHEN last_date IS NULL THEN json_extract(new.metadata,'$.createdAt.utc')
              WHEN json_extract(new.metadata,'$.createdAt.utc')>last_date THEN json_extract(new.metadata,'$.createdAt.utc')
              ELSE last_date END;
        END;
        CREATE TRIGGER IF NOT EXISTS stats_unit_delete AFTER DELETE ON units BEGIN
          UPDATE history_stats SET units=units-1,
            unknown_dates=unknown_dates-(json_extract(old.metadata,'$.createdAt.utc') IS NULL),
            first_date=(SELECT MIN(json_extract(metadata,'$.createdAt.utc')) FROM units),
            last_date=(SELECT MAX(json_extract(metadata,'$.createdAt.utc')) FROM units);
        END;
        CREATE VIRTUAL TABLE IF NOT EXISTS units_fts USING fts5(id UNINDEXED, text, tokenize='unicode61');
        CREATE TRIGGER IF NOT EXISTS units_insert AFTER INSERT ON units BEGIN
          INSERT INTO units_fts(id, text) VALUES(new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS units_delete AFTER DELETE ON units BEGIN
          DELETE FROM units_fts WHERE id=old.id;
        END;
      `);
      db.prepare('INSERT OR IGNORE INTO vault_meta VALUES (?, ?)').run('partition', partitionKey);
      db.prepare('INSERT OR IGNORE INTO vault_meta VALUES (?, ?)').run('format', 'inference-history.v4');
      db.prepare('INSERT OR IGNORE INTO vault_meta VALUES (?, ?)').run('reference_key', randomBytes(32).toString('hex'));
    }
    const metadata = Object.fromEntries(db.prepare('SELECT key, value FROM vault_meta').all().map((row) => [row.key, row.value]));
    if (metadata.partition !== partitionKey || metadata.format !== 'inference-history.v4') throw unsafe();
    if (!/^[a-f0-9]{64}$/.test(metadata.reference_key || '')) throw unsafe();
    return db;
  } catch (error) { db.close(); throw error; }
}
