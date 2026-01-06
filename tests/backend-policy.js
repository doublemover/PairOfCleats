#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBackendPolicy } from '../src/storage/backend-policy.js';

const autoDefault = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteScoreModeConfig: false,
  sqliteConfigured: true,
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(autoDefault.useSqlite, true);
assert.equal(autoDefault.useLmdb, false);
assert.equal(autoDefault.backendLabel, 'sqlite');

const autoChunkThreshold = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteConfigured: true,
  sqliteAvailable: true,
  sqliteAutoChunkThreshold: 10,
  needsSqlite: true,
  chunkCounts: [5]
});
assert.equal(autoChunkThreshold.useSqlite, false);
assert.equal(autoChunkThreshold.useLmdb, false);

const autoArtifactThreshold = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteConfigured: true,
  sqliteAvailable: true,
  sqliteAutoArtifactBytes: 100,
  needsSqlite: true,
  artifactBytes: [200]
});
assert.equal(autoArtifactThreshold.useSqlite, true);

const forcedMemory = resolveBackendPolicy({
  backendArg: 'memory',
  sqliteConfigured: true,
  sqliteAvailable: true,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(forcedMemory.useSqlite, false);
assert.equal(forcedMemory.useLmdb, false);
assert.equal(forcedMemory.backendLabel, 'memory');

const forcedSqliteMissing = resolveBackendPolicy({
  backendArg: 'sqlite',
  sqliteConfigured: true,
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
  sqliteConfigured: true,
  sqliteAvailable: false,
  lmdbAvailable: true,
  needsSqlite: true
});
assert.equal(autoFallbackLmdb.useLmdb, true);
assert.equal(autoFallbackLmdb.backendLabel, 'lmdb');

console.log('backend-policy test passed');
