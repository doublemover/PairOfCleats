#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBackendPolicy } from '../../../src/storage/backend-policy.js';

const autoDefault = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(autoDefault.useSqlite, true);
assert.equal(autoDefault.useLmdb, false);
assert.equal(autoDefault.backendLabel, 'sqlite');

const autoPreferLmdb = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true,
  defaultBackend: 'lmdb'
});
assert.equal(autoPreferLmdb.useSqlite, false);
assert.equal(autoPreferLmdb.useLmdb, true);
assert.equal(autoPreferLmdb.backendLabel, 'lmdb');

const forcedMemory = resolveBackendPolicy({
  backendArg: 'memory',
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(forcedMemory.useSqlite, false);
assert.equal(forcedMemory.useLmdb, false);
assert.equal(forcedMemory.backendLabel, 'memory');

const forcedTantivy = resolveBackendPolicy({
  backendArg: 'tantivy',
  sqliteConfigured: true,
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(forcedTantivy.useSqlite, false);
assert.equal(forcedTantivy.useLmdb, false);
assert.equal(forcedTantivy.backendLabel, 'tantivy');
assert.equal(forcedTantivy.backendForcedTantivy, true);

const forcedSqliteMissing = resolveBackendPolicy({
  backendArg: 'sqlite',
  sqliteAvailable: false,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.ok(forcedSqliteMissing.error);

const forcedLmdb = resolveBackendPolicy({
  backendArg: 'lmdb',
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(forcedLmdb.useLmdb, true);
assert.equal(forcedLmdb.backendLabel, 'lmdb');

const forcedLmdbMissing = resolveBackendPolicy({
  backendArg: 'lmdb',
  lmdbAvailable: false,
  needsSqlite: true
});
assert.ok(forcedLmdbMissing.error);

const autoFallbackLmdb = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteAvailable: false,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(autoFallbackLmdb.useLmdb, true);
assert.equal(autoFallbackLmdb.backendLabel, 'lmdb');

console.log('backend-policy test passed');
