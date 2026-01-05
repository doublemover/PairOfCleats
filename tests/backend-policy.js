#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBackendPolicy } from '../src/storage/backend-policy.js';

const autoDefault = resolveBackendPolicy({
  backendArg: 'auto',
  sqliteScoreModeConfig: false,
  sqliteConfigured: true,
  sqliteAvailable: true,
  needsSqlite: true
});
assert.equal(autoDefault.useSqlite, true);
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
  needsSqlite: true
});
assert.equal(forcedMemory.useSqlite, false);
assert.equal(forcedMemory.backendLabel, 'memory');

const forcedSqliteMissing = resolveBackendPolicy({
  backendArg: 'sqlite',
  sqliteConfigured: true,
  sqliteAvailable: false,
  needsSqlite: true
});
assert.ok(forcedSqliteMissing.error);

console.log('backend-policy test passed');
