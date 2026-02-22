#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';

applyTestEnv();

const { fixtureRoot, userConfig, codeDir } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'ann-lazy-import-merged-fallback',
  cacheScope: 'shared',
  requiredModes: ['code']
});

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

const mergedDensePath = path.join(codeDir, 'dense_vectors_uint8.json');
await fsPromises.writeFile(
  mergedDensePath,
  JSON.stringify({ vectors: [[1, 2, 3]], dims: 3, model: 'stub' }, null, 2)
);
const codeDenseEntries = await fsPromises.readdir(codeDir, { withFileTypes: true });
for (const entry of codeDenseEntries) {
  if (!entry.name.startsWith('dense_vectors_code')) continue;
  await fsPromises.rm(path.join(codeDir, entry.name), { recursive: true, force: true });
}

const withAnnAuto = await loadSearchIndexes({
  ...baseOptions,
  annActive: true,
  strict: false,
  resolvedDenseVectorMode: 'auto',
  requiredArtifacts: new Set(['ann'])
});
assert.equal(
  typeof withAnnAuto.idxCode.loadDenseVectors,
  'function',
  'expected lazy dense vector loader to be attached for ANN auto mode'
);
const loadedDense = await withAnnAuto.idxCode.loadDenseVectors();
assert.ok(
  loadedDense && Array.isArray(loadedDense.vectors) && loadedDense.vectors.length > 0,
  'expected lazy loader to fall back to merged dense vectors when split code vectors are unavailable'
);

console.log('ann lazy import test passed');
