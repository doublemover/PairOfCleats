#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRunSearchIndexAvailability } from '../../../src/retrieval/cli/run-search/index-availability.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const warningLog = [];
const calls = {
  pathExists: []
};

const dependencies = {
  resolveSingleRootForModes: () => ({ root: '/tmp/index-root', mixed: false }),
  resolveLmdbPaths: () => ({ codePath: '/lmdb/code', prosePath: '/lmdb/prose' }),
  resolveSqlitePaths: () => ({
    codePath: '/sqlite/code',
    prosePath: '/sqlite/prose',
    extractedProsePath: '/sqlite/extracted'
  }),
  pathExists: async (targetPath) => {
    calls.pathExists.push(targetPath);
    return targetPath !== '/sqlite/prose';
  },
  hasLmdbStore: (targetPath) => targetPath === '/lmdb/code',
  isLmdbReady: (state) => state?.ready === true,
  isSqliteReady: (state) => state?.ready === true,
  loadSearchIndexStates: () => ({
    code: { ready: true },
    prose: { ready: false },
    extractedProse: { ready: true },
    records: { ready: true }
  }),
  resolveRunSearchProfilePolicy: () => ({
    selectedModes: ['code', 'prose'],
    profilePolicyByMode: { code: { source: 'sqlite' }, prose: { source: 'sqlite' } },
    vectorOnlyModes: [],
    annEnabledEffective: true,
    warnings: ['profile warning']
  })
};

const availability = await resolveRunSearchIndexAvailability({
  rootDir: process.cwd(),
  userConfig: {},
  runCode: true,
  runProse: true,
  runExtractedProse: false,
  runRecords: false,
  searchMode: 'mixed',
  asOfContext: { strict: false },
  indexResolveOptions: {},
  allowSparseFallback: true,
  allowUnsafeMix: false,
  annFlagPresent: true,
  annEnabled: true,
  scoreMode: 'hybrid',
  addProfileWarning: (warning) => warningLog.push(warning),
  dependencies
});

assert.equal(availability.error, undefined);
assert.deepEqual(availability.selectedModes, ['code', 'prose']);
assert.equal(availability.annEnabledEffective, true);
assert.equal(availability.sqliteAvailability.code, true);
assert.equal(availability.sqliteAvailability.prose, false);
assert.equal(availability.sqliteAvailability.all, false, 'missing prose sqlite should mark sqlite as unavailable for requested modes');
assert.equal(availability.lmdbAvailability.code, true);
assert.equal(availability.lmdbAvailability.prose, false);
assert.equal(availability.lmdbAvailability.all, false, 'lmdb prose store missing should mark lmdb unavailable');
assert.deepEqual(warningLog, ['profile warning']);
assert.deepEqual(
  calls.pathExists.sort(),
  ['/sqlite/code', '/sqlite/extracted', '/sqlite/prose'].sort(),
  'expected sqlite existence probes for each sqlite mode path'
);

const profileError = await resolveRunSearchIndexAvailability({
  rootDir: process.cwd(),
  userConfig: {},
  dependencies: {
    ...dependencies,
    resolveRunSearchProfilePolicy: () => ({
      error: { message: 'profile policy failed', code: 'ERR_PROFILE_POLICY' }
    })
  }
});

assert.equal(profileError.error.message, 'profile policy failed');
assert.equal(profileError.error.code, 'ERR_PROFILE_POLICY');

console.log('run-search index availability test passed');
