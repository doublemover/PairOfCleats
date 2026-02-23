#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildRunSearchBackendBootstrapInput,
  resolveRunSearchModeNeeds
} from '../../../src/retrieval/cli/run-search/backend-bootstrap-input.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const modeNeeds = resolveRunSearchModeNeeds({
  runCode: true,
  runProse: false,
  runExtractedProse: true,
  searchMode: 'extracted-prose',
  commentsEnabled: true
});
assert.deepEqual(modeNeeds, {
  needsCode: true,
  needsProse: false,
  needsExtractedProse: true,
  requiresExtractedProse: true,
  joinComments: true,
  needsSqlite: true
});

const sqlitePaths = {
  codePath: '/sqlite/code',
  prosePath: '/sqlite/prose',
  extractedProsePath: '/sqlite/extracted'
};
const lmdbPaths = {
  codePath: '/lmdb/code',
  prosePath: '/lmdb/prose'
};
const sqliteAvailability = {
  all: true,
  code: true,
  prose: false,
  extractedProse: true
};
const lmdbAvailability = {
  all: false,
  code: false,
  prose: false
};
const sqliteStates = {
  code: { ready: true },
  prose: null,
  'extracted-prose': { ready: true },
  records: null
};
const lmdbStates = {
  code: { ready: true },
  prose: null
};
const sqliteCache = { id: 'sqlite-cache' };
const stageTracker = { enabled: true };
const payload = buildRunSearchBackendBootstrapInput({
  modeNeeds,
  backendArg: 'auto',
  defaultBackend: 'sqlite',
  asOfContext: { ref: 'HEAD~1' },
  emitOutput: true,
  sqliteAutoChunkThreshold: 10,
  sqliteAutoArtifactBytes: 1024,
  runCode: true,
  runProse: false,
  runExtractedProse: true,
  resolveSearchIndexDir: () => '/indexes',
  sqliteRootsMixed: false,
  lmdbRootsMixed: true,
  sqlitePaths,
  lmdbPaths,
  sqliteAvailability,
  lmdbAvailability,
  loadExtractedProseSqlite: true,
  vectorExtension: { enabled: true },
  sqliteCache,
  sqliteStates,
  lmdbStates,
  postingsConfig: { enabled: true },
  sqliteFtsWeights: { body: 1.0 },
  maxCandidates: 50,
  queryVectorAnn: () => [],
  modelIdDefault: 'test-model',
  fileChargramN: 3,
  hnswConfig: { enabled: true },
  denseVectorMode: 'hnsw',
  storageTier: 'memory',
  sqliteReadPragmas: { cacheSize: 1024 },
  rootDir: '/repo',
  userConfig: { profile: 'default' },
  stageTracker,
  vectorAnnEnabled: true
});

assert.equal(payload.selectionInput.requiresExtractedProse, true);
assert.equal(payload.selectionInput.lmdbRootsMixed, true);
assert.equal(payload.selectionInput.asOfRef, 'HEAD~1');
assert.equal(payload.selectionInput.sqliteAvailable, true);
assert.equal(payload.selectionInput.lmdbAvailable, false);
assert.equal(payload.selectionInput.needsSqlite, true);
assert.equal(payload.contextInput.loadExtractedProseSqlite, true);
assert.equal(payload.contextInput.vectorAnnEnabled, true);
assert.equal(payload.contextInput.dbCache, sqliteCache);
assert.equal(payload.contextInput.sqliteStates, sqliteStates);
assert.equal(payload.contextInput.lmdbStates, lmdbStates);
assert.equal(payload.contextInput.sqliteCodePath, '/sqlite/code');
assert.equal(payload.contextInput.lmdbCodePath, '/lmdb/code');
assert.equal(payload.contextInput.stageTracker, stageTracker);

console.log('run-search backend bootstrap input helper test passed');
