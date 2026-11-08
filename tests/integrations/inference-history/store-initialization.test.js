import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openHistoryStore, openLocalArchiveStore, openMemoryHistoryStore } from '../../../src/integrations/inference-history/store.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await makeTempDir('poc-history-initialization-');
const vault = path.join(root, 'vault'), key = 'a'.repeat(64);
await fs.mkdir(vault, { mode: 0o700 });
const exec = Database.prototype.exec, close = Database.prototype.close;
const failure = new Error('original discovery schema initialization failure');
let failedConnection, originalCloses = 0;
try {
  Database.prototype.exec = function (sql) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS history_discovery_units')) {
      failedConnection = this;
      throw failure;
    }
    return exec.call(this, sql);
  };
  Database.prototype.close = function (...args) {
    if (this === failedConnection) originalCloses++;
    return close.apply(this, args);
  };
  await assert.rejects(openHistoryStore(vault, key, { create: true, verifyPrivateVault: () => true }),
    error => error === failure, 'initialization retains the original native failure');
  assert.ok(failedConnection);
  assert.equal(originalCloses, 1, 'the original failed database connection closes exactly once');
  Database.prototype.exec = exec;
  Database.prototype.close = close;
  const partial = new Database(path.join(vault, key + '.sqlite'), { readonly: true });
  try {
    assert.equal(partial.prepare("SELECT count(*) count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().count, 0,
      'failed initialization must not commit a partial vault schema or incomplete authority metadata');
  } finally { partial.close(); }
  const options = { create: true, verifyPrivateVault: () => true };
  const db = await openHistoryStore(vault, key, options);
  let originalMetadata;
  try {
    assert.equal(db.inTransaction, false, 'successful initialization commits before admitting the caller');
    originalMetadata = Object.fromEntries(db.prepare('SELECT key, value FROM vault_meta').all().map(row => [row.key, row.value]));
    assert.match(originalMetadata.reference_key, /^[a-f0-9]{64}$/);
    assert.equal(originalMetadata.partition, key);
    for (const name of ['units_fts', 'units_discovery_fts', 'history_stats']) {
      assert.ok(db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(name), name);
    }
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  } finally { db.close(); }
  const reopened = await openHistoryStore(vault, key, options);
  try {
    assert.deepEqual(Object.fromEntries(reopened.prepare('SELECT key, value FROM vault_meta').all().map(row => [row.key, row.value])),
      originalMetadata, 'opening an initialized vault preserves its original identity and generation');
  } finally { reopened.close(); }
  for (const open of [() => openMemoryHistoryStore(key), () => openLocalArchiveStore(path.join(root, 'local.sqlite'), key)]) {
    const store = await open();
    try {
      assert.equal(store.inTransaction, false);
      assert.equal(store.prepare('SELECT value FROM vault_meta WHERE key=?').get('partition').value, key);
      assert.equal(store.pragma('quick_check', { simple: true }), 'ok');
    } finally { store.close(); }
  }
} finally {
  Database.prototype.exec = exec;
  Database.prototype.close = close;
  await rmDirRecursive(root, { retries: 0 });
}
console.log('History stores publish complete schema and identity atomically and retain original initialization failures.');
