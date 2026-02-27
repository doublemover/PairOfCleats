#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBackendSelection } from '../../../src/retrieval/cli/policy.js';

const base = {
  sqliteScoreModeConfig: false,
  sqliteConfigured: true,
  sqliteAvailable: true,
  sqliteCodeAvailable: true,
  sqliteProseAvailable: true,
  sqliteCodePath: 'code.db',
  sqliteProsePath: 'prose.db',
  lmdbConfigured: true,
  lmdbAvailable: true,
  lmdbCodeAvailable: true,
  lmdbProseAvailable: true,
  lmdbCodePath: 'lmdb-code',
  lmdbProsePath: 'lmdb-prose',
  sqliteAutoChunkThreshold: 0,
  sqliteAutoArtifactBytes: 0,
  needsSqlite: true,
  needsCode: true,
  needsProse: false,
  root: process.cwd(),
  userConfig: {}
};

const autoResult = await resolveBackendSelection({
  ...base,
  backendArg: ''
});
assert.equal(autoResult.useSqlite, true, 'expected auto backend to select sqlite');
assert.equal(autoResult.useLmdb, false, 'expected auto backend to avoid lmdb');

const lmdbFallback = await resolveBackendSelection({
  ...base,
  backendArg: '',
  sqliteAvailable: false,
  sqliteCodeAvailable: false,
  lmdbAvailable: true
});
assert.equal(lmdbFallback.useSqlite, false, 'expected sqlite to be skipped when unavailable');
assert.equal(lmdbFallback.useLmdb, true, 'expected lmdb to be selected when available');

const forcedSqlite = await resolveBackendSelection({
  ...base,
  backendArg: 'sqlite',
  sqliteAvailable: false,
  sqliteCodeAvailable: false
});
assert.ok(forcedSqlite.error, 'expected sqlite error when forced and missing');
assert.ok(forcedSqlite.error.message.includes('SQLite backend requested'), 'expected sqlite error message');
assert.ok(forcedSqlite.error.message.includes('code=code.db'), 'expected sqlite missing path in message');

const forcedLmdb = await resolveBackendSelection({
  ...base,
  backendArg: 'lmdb',
  lmdbAvailable: false,
  lmdbCodeAvailable: false
});
assert.ok(forcedLmdb.error, 'expected lmdb error when forced and missing');
assert.ok(forcedLmdb.error.message.includes('LMDB backend requested'), 'expected lmdb error message');
assert.ok(forcedLmdb.error.message.includes('code=lmdb-code'), 'expected lmdb missing path in message');

const forcedTantivy = await resolveBackendSelection({
  ...base,
  backendArg: 'tantivy'
});
assert.equal(forcedTantivy.useSqlite, false, 'expected tantivy to avoid sqlite');
assert.equal(forcedTantivy.useLmdb, false, 'expected tantivy to avoid lmdb');
assert.equal(forcedTantivy.backendPolicy.backendLabel, 'tantivy', 'expected tantivy backend label');
assert.equal(forcedTantivy.backendForcedTantivy, true, 'expected tantivy backend flag');

console.log('retrieval backend policy test passed');
