#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';

process.env.PAIROFCLEATS_TESTING = '1';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({ fixtureName: 'sample' });

const baseOptions = {
  rootDir: fixtureRoot,
  userConfig,
  searchMode: 'code',
  runProse: false,
  runExtractedProse: false,
  runCode: true,
  runRecords: false,
  useSqlite: false,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: false,
  filtersActive: false,
  contextExpansionEnabled: false,
  graphRankingEnabled: false,
  sqliteFtsRequested: false,
  backendLabel: 'memory',
  backendForcedTantivy: false,
  indexCache: null,
  modelIdDefault: 'test',
  fileChargramN: 3,
  hnswConfig: {},
  lancedbConfig: { enabled: true },
  tantivyConfig: {},
  strict: true,
  indexStates: null,
  loadIndexFromSqlite: () => {
    throw new Error('unexpected sqlite load');
  },
  loadIndexFromLmdb: () => {
    throw new Error('unexpected lmdb load');
  },
  resolvedDenseVectorMode: 'merged',
  loadExtractedProse: false
};

const withoutAnn = await loadSearchIndexes({
  ...baseOptions,
  requiredArtifacts: new Set()
});

assert.equal(
  withoutAnn.idxCode.lancedb,
  undefined,
  'expected lancedb metadata to be skipped when ann not required'
);

const withAnn = await loadSearchIndexes({
  ...baseOptions,
  annActive: true,
  requiredArtifacts: new Set(['ann'])
});

assert.ok(
  withAnn.idxCode.lancedb && typeof withAnn.idxCode.lancedb === 'object',
  'expected lancedb metadata when ann required'
);

console.log('ann lazy import test passed');
