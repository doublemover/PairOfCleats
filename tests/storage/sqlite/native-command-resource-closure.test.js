import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-command-close-'));
try {
  let database;
  await runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, resources => {
    database = resources.own(new Database(path.join(root, 'closed.sqlite')));
    database.exec('CREATE TABLE facts(value TEXT)');
    database.prepare('INSERT INTO facts VALUES (?)').run('retained');
  });
  assert.equal(database.open, false, 'actual SQLite handle is closed after ordinary return');
  const failure = new Error('write failed before explicit closure');
  await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, resources => {
    database = resources.own(new Database(path.join(root, 'failed.sqlite')));
    throw failure;
  }), error => error === failure);
  assert.equal(database.open, false, 'an early preparation/work failure still closes its actual handle');
  const reopened = new Database(path.join(root, 'closed.sqlite'));
  try { assert.equal(reopened.prepare('SELECT value FROM facts').get().value, 'retained'); }
  finally { reopened.close(); }

  // Async LMDB-shaped closure controls test the actual registry await boundary;
  // these controls do not claim native LMDB execution or process-tree proof.
  let release, began, closed = false, returned = false;
  const closing = new Promise(resolve => { began = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const operation = runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, resources => {
    resources.own({ close: async callback => { began(); await wait; closed = true; callback(); } });
  }).then(() => { returned = true; });
  await closing;
  assert.equal(returned, false);
  release();
  await operation;
  assert.equal(closed, true);

  const primary = Object.freeze(new Error('primary LMDB write error'));
  const cleanup = new Error('native close has unknown settlement');
  let closeCalls = 0;
  await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async resources => {
    const handle = resources.own({ close: () => { closeCalls++; throw cleanup; } });
    await resources.use(handle, () => { throw primary; });
  }), error => error.cause?.cause === primary && error.nativeCleanupError === cleanup
    && error.cacheOwnershipReleased() === false && primary.nativeCleanupError === undefined,
  'exact primary and cleanup remain separate causes without mutating a frozen operation failure');
  assert.equal(closeCalls, 1, 'an uncertain failed close is retained rather than retried or marked closed');
  await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'sqlite.compact' }, async resources => {
    await resources.close({ close() {} });
  }), /another native command/);
  await assert.rejects(runNativeDatabaseCommand({ commandIdentity: 'unreviewed.command' }, () => {}),
    /Unknown native database command/);
  console.log('Canonical native database resources await actual closure and preserve primary errors');
} finally { await fs.rm(root, { recursive: true, force: true }); }
