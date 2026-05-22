#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyBuildPragmas, restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

import { loadSqlitePragmaDatabase, openPragmaTestDatabase } from './helpers/pragmas-fixture.js';

const Database = await loadSqlitePragmaDatabase();
const { db } = await openPragmaTestDatabase({
  label: 'sqlite-wal-size-limit',
  name: 'wal.db',
  Database
});
const state = applyBuildPragmas(db, { inputBytes: 2 * 1024 * 1024 * 1024, stats: {} });
const journalLimit = Number(state.applied.journal_size_limit || 0);
const walCheckpoint = Number(state.applied.wal_autocheckpoint || 0);
const lockingMode = state.applied.locking_mode;

assert.ok(journalLimit > 0, 'expected journal_size_limit to be applied');
assert.ok(walCheckpoint > 0, 'expected wal_autocheckpoint to be applied');
assert.ok(lockingMode === 'EXCLUSIVE' || lockingMode === 'exclusive', 'expected locking_mode to be EXCLUSIVE');

restoreBuildPragmas(db, state);
db.close();

console.log('sqlite wal size limit test passed');
