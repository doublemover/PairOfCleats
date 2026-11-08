import assert from 'node:assert/strict';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { validateEmbeddingIdentityForMode, attachLanceDb, attachDenseVectorLoader } from '../../../src/retrieval/cli/ann-backends.js';
import { loadSearchHnswIndex } from '../../../src/retrieval/index-hydration.js';
import { buildEmbeddingGeneration } from '../../../src/shared/embedding-generation.js';

const identity = changes => buildEmbeddingIdentity({ modelId: 'fixture/same-model', provider: 'transformers',
  mode: 'inline', dims: 2, normalize: true, scale: 1,
  quantization: { minVal: -1, maxVal: 1, levels: 256 },
  modelArtifact: { status: 'verified-local', reuse: 'allow', method: 'local-artifacts-sha256',
    digest: 'a'.repeat(64), revision: null }, ...changes });
const original = identity({});
const index = current => ({
  state: { embeddings: { embeddingIdentity: current } },
  denseVec: { ...current, model: current.modelId },
  hnsw: { available: true, index: { fixture: true }, meta: {
    ...original, model: original.modelId, version: 1, count: 2, expectedCount: 2,
    space: 'cosine', m: 16, efConstruction: 200, efSearch: 50 } },
  lancedb: { available: true, meta: { ...original, model: original.modelId, version: 1, count: 2,
    metric: 'cosine', table: 'vectors', embeddingColumn: 'vector', idColumn: 'id' } }
});

const matching = index(original);
assert.deepEqual(validateEmbeddingIdentityForMode('code', matching, true), []);
assert.equal(matching.hnsw.available, true);
assert.equal(matching.lancedb.available, true);
for (const changed of [identity({ normalize: false }), identity({ modelArtifact: {
  ...original.modelArtifact, digest: 'b'.repeat(64) } })]) {
  assert.equal(changed.modelId, original.modelId);
  assert.equal(changed.dims, original.dims);
  const strict = index(changed);
  const strictMismatches = validateEmbeddingIdentityForMode('code', strict, true);
  for (const backend of ['hnsw', 'lancedb']) {
    assert.ok(strictMismatches.some(row => row.source === backend),
      `${backend}: strict identity compares model bytes and normalization at constant name/dimensions`);
  }
  assert.equal(strict.hnsw.available, true, 'strict validation reports before the caller rejects; it does not mutate');
  const degraded = index(changed);
  const mismatches = validateEmbeddingIdentityForMode('code', degraded, false);
  assert.ok(mismatches.length >= 2);
  assert.equal(degraded.hnsw.available, false, 'stale HNSW must not serve under the new identity');
  assert.equal(degraded.hnsw.index, null);
  assert.equal(degraded.lancedb.available, false, 'stale LanceDB must not serve under the new identity');
  assert.deepEqual(degraded.denseVec, { ...changed, model: changed.modelId }, 'current dense-vector fallback remains intact');
}
const generation = 'c'.repeat(64);
for (const state of [{ ready: false }, { pending: true }]) {
  const pending = { state: { embeddings: { ...state, embeddingIdentity: original, embeddingGeneration: generation } } };
  assert.deepEqual(loadSearchHnswIndex({ indexPath: 'must-never-open-native-bytes', hnswMeta: {},
    embeddingsState: pending.state.embeddings }), { index: null, available: false });
  const lance = await attachLanceDb({ idx: pending, mode: 'code', dir: 'must-never-read-a-manifest',
    lancedbConfig: { enabled: true }, resolvedDenseVectorMode: 'merged', strict: true });
  assert.equal(lance.available, false);
  attachDenseVectorLoader({ idx: pending, mode: 'code', dir: 'must-never-read-a-manifest', needsAnnArtifacts: true,
    lazyDenseVectorsEnabled: true, resolvedDenseVectorMode: 'merged', strict: true });
  assert.equal(await pending.loadDenseVectors(), null);
}
const current = index(original);
current.state.embeddings.embeddingGeneration = generation;
current.hnsw.meta.embeddingIdentity = original;
current.lancedb.meta.embeddingIdentity = original;
for (const meta of [current.denseVec, current.hnsw.meta, current.lancedb.meta]) meta.embeddingGeneration = generation;
assert.deepEqual(validateEmbeddingIdentityForMode('code', current, true), []);
for (const missing of [null, 'd'.repeat(64)]) {
  const stale = structuredClone(current);
  stale.hnsw.meta.embeddingGeneration = missing;
  stale.lancedb.meta.embeddingGeneration = missing;
  assert.equal(validateEmbeddingIdentityForMode('code', stale, true).length, 2);
  validateEmbeddingIdentityForMode('code', stale, false);
  assert.equal(stale.hnsw.available, false);
  assert.equal(stale.lancedb.available, false);
  const args = { indexPath: 'must-never-open-native-bytes', hnswConfig: { enabled: true },
    hnswMeta: stale.hnsw.meta, embeddingsState: stale.state.embeddings, denseVec: stale.denseVec };
  assert.throws(() => loadSearchHnswIndex(args), /Embedding identity mismatch.*before HNSW load/);
  assert.deepEqual(loadSearchHnswIndex({ ...args, strict: false }), { index: null, available: false });
}
const input = { embeddingIdentity: original,
  chunksByFile: new Map([['a.js', [{ index: 0, chunk: { file: 'a.js', id: 0, chunkId: 'a', start: 0, end: 4 } }]]]),
  vectors: { merged: [new Uint8Array([8, 9]), null], doc: [null, null], code: [[8, 9], null] } };
const baseline = buildEmbeddingGeneration(input);
assert.equal(buildEmbeddingGeneration(structuredClone(input)), baseline);
for (const change of [
  value => { value.embeddingIdentity.normalize = false; },
  value => { value.chunksByFile.get('a.js')[0].index = 1; },
  value => { value.chunksByFile.get('a.js')[0].chunk.chunkId = 'b'; },
  value => { value.vectors.code[0][1] = 10; },
  value => { value.vectors.doc[1] = [8, 9]; },
  value => { value.vectors.merged.reverse(); }
]) {
  const changed = structuredClone(input);
  change(changed);
  assert.notEqual(buildEmbeddingGeneration(changed), baseline);
}
console.log('ANN admission compares complete embedding identity and preserves current dense fallback on stale native backends.');
