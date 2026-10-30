#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { materializeDenseVectorRows } from '../../../src/shared/dense-vector-artifacts.js';
import { runNode } from '../../helpers/run-node.js';
import { checksumFile } from '../../../src/shared/hash.js';

applyTestEnv();

const { fixtureRoot, userConfig, codeDir, env, root } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'ann-lazy-import-merged-fallback',
  cacheScope: 'isolated',
  buildStage: 'stage1',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ indexing: { embeddings: {
    enabled: true, mode: 'inline', hnsw: { enabled: false }, lancedb: { enabled: false }
  } } }) },
  requiredModes: ['code']
});
runNode([path.join(root, 'tools/build/embeddings.js'), '--repo', fixtureRoot, '--mode', 'code', '--stub-embeddings'],
  'build the fallback fixture embedding generation', fixtureRoot, env, { stdio: 'pipe', timeoutMs: 30000 });

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
const currentDense = await withAnn.idxCode.loadDenseVectors();
assert.ok(currentDense, 'the positive fallback must originate in a real ready generation');
const expectedVectors = materializeDenseVectorRows(currentDense).map(vector => Array.from(vector));
assert.ok(expectedVectors.length > 0);
const legacyPayload = { vectors: expectedVectors,
  ...Object.fromEntries(['dims', 'model', 'scale', 'minVal', 'maxVal', 'levels', 'embeddingIdentity', 'embeddingGeneration']
    .map(key => [key, currentDense[key]])) };
await fsPromises.writeFile(
  mergedDensePath,
  JSON.stringify(legacyPayload)
);
const codeDenseEntries = await fsPromises.readdir(codeDir, { withFileTypes: true });
for (const entry of codeDenseEntries) {
  const splitCode = entry.name.startsWith('dense_vectors_code');
  const mergedCurrent = entry.name.startsWith('dense_vectors_uint8') && entry.name !== 'dense_vectors_uint8.json';
  if (!splitCode && !mergedCurrent) continue;
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
assert.deepEqual(loadedDense.vectors, expectedVectors, 'merged fallback preserves every published vector, dimension and ordinal');
assert.equal(loadedDense.embeddingGeneration, currentDense.embeddingGeneration);
assert.equal(await withAnnAuto.idxCode.loadDenseVectors(), loadedDense, 'the validated payload is memoized for warm reads');
for (const rejected of [
  { ...legacyPayload, embeddingIdentity: undefined, embeddingGeneration: undefined },
  { ...legacyPayload, embeddingGeneration: '0'.repeat(64) },
  { ...legacyPayload, embeddingIdentity: { ...legacyPayload.embeddingIdentity,
    normalize: !legacyPayload.embeddingIdentity.normalize } }
]) {
  await fsPromises.writeFile(mergedDensePath, JSON.stringify(rejected));
  const fresh = await loadSearchIndexes({ ...baseOptions, annActive: true, strict: false,
    resolvedDenseVectorMode: 'auto', requiredArtifacts: new Set(['ann']) });
  assert.equal(await fresh.idxCode.loadDenseVectors(), null, 'unbound, stale or incompatible bytes cannot become a positive fallback');
}
const manifestPath = path.join(codeDir, 'pieces/manifest.json');
const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
const checksum = await checksumFile(mergedDensePath);
manifest.pieces = manifest.pieces.filter(piece => piece.name !== 'dense_vectors'
  && piece.name !== 'dense_vectors_binary_meta' && !piece.name.startsWith('dense_vectors_code'));
manifest.pieces.push({ type: 'embeddings', name: 'dense_vectors', format: 'json', path: 'dense_vectors_uint8.json',
  count: expectedVectors.length, dims: currentDense.dims,
  bytes: (await fsPromises.stat(mergedDensePath)).size, checksum: `${checksum.algo}:${checksum.value}` });
await fsPromises.writeFile(manifestPath, JSON.stringify(manifest));
const strictInvalid = await loadSearchIndexes({ ...baseOptions, annActive: true, strict: true,
  resolvedDenseVectorMode: 'auto', requiredArtifacts: new Set(['ann']) });
await assert.rejects(strictInvalid.idxCode.loadDenseVectors(), /Embedding identity mismatch/,
  'a valid manifest/checksum cannot suppress strict rejection of incompatible legacy metadata');

console.log('ann lazy import test passed');
