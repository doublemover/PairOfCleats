import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Tensor } from 'onnxruntime-common';
import { admitEmbeddingVector } from '../../../src/shared/embedding-output-admission.js';
import { resolveQueryEmbeddingContract } from '../../../src/shared/embedding-model-profile.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import { __setAdapterFactoryForTests, __setTransformersModuleLoaderForTests,
  disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { isEmbeddingReady } from '../../../src/retrieval/ann/utils.js';
import { normalizeEmbeddingDims } from '../../../src/retrieval/ann/dims.js';
import { rankHnswIndex } from '../../../src/shared/hnsw.js';
import { runAnnStage } from '../../../src/retrieval/pipeline/ann-stage.js';
import { createProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ embeddings: null, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('query-vector-admission/')[1];
assert.ok(['admission', 'cache', 'ann', 'query', 'generic', 'onnx', 'prepared'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`query-vector-admission-${selected}`);
const invalid = [Float32Array.of(NaN, 2, 3), [], [1], [1, 2, 3, 4], ['1', 2, 3], [1e100, 2, 3], new Int32Array([1, 2, 3]), new DataView(new ArrayBuffer(12))];
for (const value of [NaN, Infinity, -Infinity]) for (let column = 0; column < 3; column++) {
  for (const make of [values => values, Float32Array.from.bind(Float32Array), Float64Array.from.bind(Float64Array)]) {
    const values = [1, 2, 3]; values[column] = value; invalid.push(make(values));
  }
}
const good = Float32Array.of(1, 2, 3);
const warnings = [], originalWarn = console.warn;
console.warn = value => warnings.push(String(value));
let hook = null;
try {
  if (selected === 'admission') {
    for (const vector of invalid) {
      assert.throws(() => admitEmbeddingVector(vector, { dimensions: 3 }), { code: 'ERR_EMBEDDING_OUTPUT' });
      assert.equal(isEmbeddingReady(vector, 3), false);
      assert.equal(normalizeEmbeddingDims(vector, 3).embedding, null);
    }
    assert.equal(admitEmbeddingVector(good, { dimensions: 3 }), good, 'valid owned values need no copy or mutation');
    assert.deepEqual(normalizeEmbeddingDims(good, null).embedding, [1, 2, 3]);
    assert.equal(isEmbeddingReady([0, 0], 2), true, 'generic L2 vectors have no invented nonzero-norm policy');
    assert.throws(() => admitEmbeddingVector([0, 0], { requireNonzero: true }), { code: 'ERR_EMBEDDING_OUTPUT' });
    const contract = resolveQueryEmbeddingContract({ modelId: 'onnx-community/embeddinggemma-2-ONNX',
      modelProfile: { dimensions: 128 }, dims: 128 });
    assert.deepEqual(contract, { dimensions: 128, requireNonzero: true, unitNorm: true });
    assert.throws(() => admitEmbeddingVector(new Float32Array(128).fill(1), contract), { code: 'ERR_EMBEDDING_OUTPUT' });
    const normalized = new Float32Array(128).fill(1 / Math.sqrt(128));
    assert.equal(admitEmbeddingVector(normalized, contract), normalized);
    for (let column = 0; column < normalized.length; column++) for (const value of [NaN, Infinity, -Infinity]) {
      const previous = normalized[column]; normalized[column] = value;
      assert.throws(() => admitEmbeddingVector(normalized, contract), { code: 'ERR_EMBEDDING_OUTPUT' });
      normalized[column] = previous;
    }
    assert.throws(() => resolveQueryEmbeddingContract({ modelId: 'onnx-community/embeddinggemma-2-ONNX',
      modelProfile: { dimensions: 128 }, dims: 256 }), { code: 'ERR_EMBEDDING_OUTPUT' });
  } else if (selected === 'cache') {
    for (const vector of invalid) {
      let calls = 0;
      const impl = async () => ++calls === 1 ? vector : Float32Array.of(1, 2, 3);
      const make = () => createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: 'private query',
        modelConfig: {}, rootDir: dir, useStubEmbeddings: true, getQueryEmbeddingImpl: impl });
      const first = make()( 'fixture', 3, true, null);
      assert.equal(await first, null);
      assert.equal(calls, 1, 'invalid output is not automatically retried');
      const value = await make()('fixture', 3, true, null);
      assert.deepEqual(value, good); assert.equal(calls, 2);
      assert.deepEqual(await make()('fixture', 3, true, null), good); assert.equal(calls, 2);
      value[0] = NaN;
      assert.equal(await make()('fixture', 3, true, null), null, 'a subsequently corrupted cache result is evicted before reuse');
      assert.deepEqual(await make()('fixture', 3, true, null), good); assert.equal(calls, 3);
    }
    let identityCalls = 0;
    const resolver = createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: 'private query',
      modelConfig: {}, rootDir: dir, useStubEmbeddings: true,
      getQueryEmbeddingImpl: async () => { identityCalls++; return good; } });
    const identity = dims => buildEmbeddingIdentity({ modelId: 'fixture', dims, stub: true,
      modelArtifact: resolveEmbeddingArtifactIdentity({ stub: true }) });
    await assert.rejects(resolver('fixture', 3, true, null, null, identity(2)), { code: 'ERR_EMBEDDING_OUTPUT' });
    assert.equal(identityCalls, 0, 'conflicting persisted/requested widths reject before provider work');
    assert.deepEqual(await resolver('fixture', 3, true, null, null, identity(3)), good);
    assert.deepEqual(warnings, ['[embeddings] Query vector rejected; skipping ANN (ERR_EMBEDDING_OUTPUT).']);
  } else if (selected === 'ann') {
    let nativeCalls = 0, providerCalls = 0;
    const index = { getCurrentCount: () => 1, searchKnn: () => { nativeCalls++; return { neighbors: [0], distances: [0] }; } };
    const provider = { id: 'dense', isAvailable: () => true, query: () => { providerCalls++; return [{ idx: 0, sim: 1 }]; } };
    const sparse = [{ idx: 0, score: 4 }];
    for (const vector of invalid) {
      assert.deepEqual(rankHnswIndex({ index, space: 'cosine', meta: { dims: 3 } }, vector, 1), []);
      const metrics = {};
      const result = await runAnnStage({ idx: { denseVec: { dims: 3 }, loadDenseVectors() {} }, mode: 'code',
        meta: [{}], queryEmbedding: async () => vector, queryTokens: ['needle'], searchTopN: 1, expandedTopN: 1,
        annEnabledForMode: true, vectorOnlyProfile: false, profileId: 'default', annOrder: ['dense'],
        adaptiveProvidersEnabled: false, getAnnProviders: () => new Map([['dense', provider]]),
        warnAnnFallback() {}, providerRuntime: createProviderRuntime(), candidatePool: { acquire: () => new Set() },
        trackReleaseSet() {}, candidates: new Set([0]), bmHits: sparse, allowedIdx: null, allowedCount: 1,
        filtersEnabled: false, annCandidatePolicyConfig: {}, hasAllowedId: (set, id) => set.has(id),
        ensureAllowedSet: value => value, bitmapToSet: value => value, rankMinhash: () => [], annMetrics: metrics });
      assert.deepEqual(result.annHits, []); assert.equal(metrics.vectorActive, false);
      assert.deepEqual([...result.candidates], [0]); assert.deepEqual(sparse, [{ idx: 0, score: 4 }], 'sparse hits remain usable');
    }
    assert.equal(nativeCalls, 0); assert.equal(providerCalls, 0, 'invalid queries cannot reach ANN providers');
    assert.equal(rankHnswIndex({ index, space: 'cosine', meta: { dims: 3 } }, good, 1).length, 1);
    assert.equal(nativeCalls, 1, 'the same native boundary accepts a valid query');
  } else if (selected === 'query') {
    let output = good, closes = 0, requests = 0;
    __setAdapterFactoryForTests(() => ({ async embedOne() { requests++; return output; }, async dispose() { closes++; },
      executionInfo: () => ({ provider: 'stub', requestedProvider: 'stub' }) }));
    for (const vector of invalid) {
      output = vector;
      assert.equal(await getQueryEmbedding({ text: 'private query', modelId: 'fixture', dims: 3, useStub: true }), null);
    }
    output = good;
    assert.deepEqual(await getQueryEmbedding({ text: 'valid retry', modelId: 'fixture', dims: 3, useStub: true }), good);
    await disposeEmbeddingAdapterCaches();
    assert.ok(closes > 0); assert.equal(requests, invalid.length + 1);
    assert.ok(warnings.every(value => value.includes('ERR_EMBEDDING_OUTPUT') && !value.includes('private query')));
  } else {
    const prepared = selected === 'prepared', onnx = selected === 'onnx';
    const modelId = prepared ? 'onnx-community/embeddinggemma-2-ONNX' : `fixture-${selected}`;
    const profile = prepared ? { dimensions: 128 } : null, dimensions = prepared ? 128 : 3;
    const modelsDir = path.join(dir, 'models'), modelRoot = path.join(modelsDir, modelId);
    await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
    for (const name of ['model.onnx', 'model_quantized.onnx']) await fs.writeFile(path.join(modelRoot, 'onnx', name), 'inert selected fixture weights');
    await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{}');
    let output = prepared ? new Float32Array(768).fill(1) : good, runs = 0, creates = 0, closes = 0;
    const tokenizer = Object.assign((texts, request = {}) => request.return_tensor === false
      ? { input_ids: texts.map(() => [101, 102]), attention_mask: texts.map(() => [1, 1]) }
      : { input_ids: new Tensor('int64', BigInt64Array.from(texts.flatMap(() => [101n, 102n])), [texts.length, 2]),
        attention_mask: new Tensor('int64', BigInt64Array.from(texts.flatMap(() => [1n, 1n])), [texts.length, 2]) },
    { pad_token_id: 0, padding_side: 'right', dispose() {} });
    const makeModel = () => { creates++; return Object.assign(async () => {
      runs++; return { sentence_embedding: new Tensor('float32', Float32Array.from(output), [1, output.length]) };
    }, { dispose() { closes++; } }); };
    if (onnx) {
      const key = Symbol.for('poc-query-vector-onnx');
      globalThis[key] = { Tensor, env: {}, AutoTokenizer: { from_pretrained: async () => tokenizer },
        InferenceSession: { create: async () => { creates++; return {
          inputNames: ['input_ids', 'attention_mask'], async run() { runs++; return { sentence_embedding:
            new Tensor('float32', Float32Array.from(output), [1, output.length]) }; }, release() { closes++; }
        }; } } };
      hook = registerHooks({ resolve(specifier, context, next) {
        return ['onnxruntime-node', '@huggingface/transformers'].includes(specifier)
          ? { url: `query-output-fixture:${specifier}`, shortCircuit: true } : next(specifier, context);
      }, load(url, context, next) { return url.startsWith('query-output-fixture:')
        ? { format: 'module', shortCircuit: true, source: 'export const { Tensor, env, AutoTokenizer, InferenceSession } = globalThis[Symbol.for("poc-query-vector-onnx")];' }
        : next(url, context); } });
    } else {
      __setTransformersModuleLoaderForTests(async () => prepared ? {
        env: { version: '4.3.2' }, Tensor, EmbeddingGemma2Model: class {},
        AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2' }) },
        AutoTokenizer: { from_pretrained: async () => tokenizer }, AutoModel: { from_pretrained: async () => makeModel() }
      } : { env: {}, pipeline: async () => { creates++; return Object.assign(async texts => {
        runs++; return texts.map(() => output);
      }, { dispose() { closes++; } }); } });
    }
    const provider = onnx ? 'onnx' : 'xenova';
    const makeResolver = text => createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: text,
      modelConfig: { dir: modelsDir }, rootDir: dir, embeddingProvider: provider, embeddingOnnx: {} });
    const resolve = text => makeResolver(text)(modelId, dimensions, true, null, profile);
    const bad = prepared ? [new Float32Array(768), ...[0, 127, 128, 767].flatMap(column =>
      [NaN, Infinity, -Infinity].map(value => { const vector = new Float32Array(768).fill(1); vector[column] = value; return vector; }))]
      : invalid.filter(vector => (Array.isArray(vector) || vector instanceof Float32Array || vector instanceof Float64Array)
        && (!onnx || Array.from(vector).every(value => typeof value === 'number')));
    for (let i = 0; i < bad.length; i++) {
      output = bad[i];
      const text = `private query ${i}`;
      assert.equal(await resolve(text), null, `${selected} invalid provider output cannot fulfill the query cache`);
      const afterFailure = runs;
      output = prepared ? new Float32Array(768).fill(1) : good;
      const accepted = await resolve(text);
      assert.ok(accepted, JSON.stringify({ selected, i, runs, warnings })); assert.equal(accepted.length, dimensions); assert.ok(Array.from(accepted).every(Number.isFinite));
      assert.equal(runs, afterFailure + 1, 'the next query performs a fresh valid inference');
      assert.deepEqual(await resolve(text), accepted); assert.equal(runs, afterFailure + 1, 'valid output remains cached');
    }
    await disposeEmbeddingAdapterCaches();
    assert.equal(closes, creates, 'all actual adapter/session owners close');
    assert.ok(warnings.length > 0); assert.ok(warnings.every(value => !value.includes('private query')));
  }
} finally {
  console.warn = originalWarn;
  await disposeEmbeddingAdapterCaches();
  __setAdapterFactoryForTests(null); __setTransformersModuleLoaderForTests(null);
  hook?.deregister(); delete globalThis[Symbol.for('poc-query-vector-onnx')];
}
console.log(`Query vector ${selected}: exact admission, invalid-result eviction, sparse fallback and original provider ownership.`);
