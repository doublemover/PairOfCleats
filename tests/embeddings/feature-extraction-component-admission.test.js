import assert from 'node:assert/strict';
import { FeatureExtractionPipeline, Tensor, env } from '@huggingface/transformers';
import { loadEmbeddingModelComponents } from '../../src/shared/embedding-model-loading.js';
import { prefetchEmbeddingModel } from '../../src/shared/embedding-model-prefetch.js';
import { captureTransformersResource, getPendingTransformersResourceOwners } from '../../src/shared/embedding-transformers-resources.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const modelId = 'fixture/local-text-components';
const modelsDir = 'C:/fixture/custom-model-cache';
const initialEnvironment = { ...env };
const initialOwners = new Set(getPendingTransformersResourceOwners());
const rejected = work => work.then(() => assert.fail('expected component acquisition or cleanup failure'), error => error);
const makeModule = ({ tokenizer, model, Pipeline = FeatureExtractionPipeline, onTokenizer = () => {}, onModel = () => {} }) => ({
  env: { version: '4.3.2' }, FeatureExtractionPipeline: Pipeline,
  AutoTokenizer: { from_pretrained: async (id, options) => { onTokenizer(id, options); return tokenizer; } },
  AutoModel: { from_pretrained: async (id, options) => { onModel(id, options); return model; } },
  pipeline: () => assert.fail('factory discovery must not decide text component admission')
});

try {
  const closes = [], calls = [];
  const tokenizer = Object.assign(texts => {
    assert.deepEqual(texts, ['short', 'two words']);
    return { attention_mask: new Tensor('int64', BigInt64Array.of(1n, 0n, 1n, 1n), [2, 2]) };
  }, { dispose() { assert.equal(this, tokenizer); closes.push('tokenizer'); } });
  const model = Object.assign(async inputs => {
    assert.deepEqual(inputs.attention_mask.dims, [2, 2]);
    return { last_hidden_state: new Tensor('float32', Float32Array.of(3, 4, 100, 100, 1, 0, 1, 0), [2, 2, 2]) };
  }, { dispose() { assert.equal(this, model); closes.push('model'); } });
  const sessions = { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false };
  const mod = makeModule({ tokenizer, model,
    onTokenizer: (id, options) => calls.push(['tokenizer', id, options]),
    onModel: (id, options) => calls.push(['model', id, options]) });
  const loading = loadEmbeddingModelComponents(mod, { modelId, modelsDir, localFilesOnly: true, sessionOptions: sessions });
  sessions.intraOpNumThreads = 8;
  const loaded = await loading;
  assert.deepEqual(calls.map(row => row.slice(0, 2)), [['tokenizer', modelId], ['model', modelId]]);
  for (const [, , options] of calls) {
    assert.deepEqual(options, { dtype: 'q8', cache_dir: modelsDir, local_files_only: true,
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false } });
  }
  assert(loaded.pipeline instanceof FeatureExtractionPipeline);
  assert.equal(loaded.pipeline.tokenizer, tokenizer);
  assert.equal(loaded.pipeline.model, model);
  assert.equal(loaded.pipeline.apply, undefined, 'the actual upstream callable does not inherit Function.apply');
  const output = await loaded.pipeline(['short', 'two words'], { pooling: 'mean', normalize: true });
  assert.deepEqual(output.dims, [2, 2]);
  for (const [index, expected] of [0.6, 0.8, 1, 0].entries()) assert(Math.abs(output.data[index] - expected) < 1e-6);
  await output.dispose();
  tokenizer.dispose = () => assert.fail('retain original tokenizer disposer');
  model.dispose = () => assert.fail('retain original model disposer');
  const firstClose = loaded.pipeline.dispose();
  assert.equal(loaded.pipeline.dispose(), firstClose, 'concurrent closure joins the original component owner');
  await firstClose;
  await loaded.pipeline.dispose();
  assert.deepEqual(closes, ['model', 'tokenizer']);
  assert.equal(loaded.resourceOwner.pending, false);

  // A real versioned runtime cannot fall back when any component export is
  // absent, and a partially supplied unversioned module is equally invalid.
  for (const override of [{ AutoTokenizer: undefined }, { AutoModel: undefined }, { FeatureExtractionPipeline: undefined },
    { env: {}, AutoModel: undefined }, { env: {}, AutoTokenizer: {}, AutoModel: undefined, FeatureExtractionPipeline: undefined }]) {
    const partial = { ...mod, ...override };
    await assert.rejects(loadEmbeddingModelComponents(partial, { modelId }), /require AutoTokenizer, AutoModel and FeatureExtractionPipeline/);
  }
  await assert.rejects(loadEmbeddingModelComponents({ env: { version: '4.3.2' }, pipeline: mod.pipeline }, { modelId }),
    /require AutoTokenizer, AutoModel and FeatureExtractionPipeline/);

  // Model startup failure retains the original tokenizer and both original
  // errors; reconciliation retries only that captured disposer.
  const startupFailure = Object.freeze(new Error('original model startup failure'));
  const cleanupFailure = Object.freeze(new Error('original tokenizer cleanup failure'));
  let tokenizerCloses = 0, modelLoads = 0;
  const partialTokenizer = Object.assign(() => ({}), { dispose() {
    tokenizerCloses++; if (tokenizerCloses === 1) throw cleanupFailure;
  } });
  const startupModule = makeModule({ tokenizer: partialTokenizer, model, onModel: () => { modelLoads++; throw startupFailure; } });
  const startup = await rejected(loadEmbeddingModelComponents(startupModule, { modelId, modelsDir, localFilesOnly: true }));
  assert.equal(startup.cause, startupFailure);
  const startupOwner = startup.cleanupErrors[0].transformersResourceOwner;
  assert.equal(startupOwner.resources[0].resource, partialTokenizer);
  assert.equal(startupOwner.resources[0].lastError.cause, cleanupFailure);
  partialTokenizer.dispose = () => assert.fail('reconciliation keeps original partial component');
  await startupOwner.release();
  assert.equal(tokenizerCloses, 2); assert.equal(modelLoads, 1);
  assert.equal(startup.cacheOwnershipReleased(), true);

  let externalClosed = false, retainedTokenizerCloses = 0, retainedModelLoads = 0;
  const pendingStartup = Object.freeze(Object.defineProperties(new Error('original model startup still owns work'), {
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => externalClosed }
  }));
  const pendingModule = makeModule({ model,
    tokenizer: Object.assign(() => ({}), { dispose() { retainedTokenizerCloses++; } }),
    onModel: () => { retainedModelLoads++; throw pendingStartup; } });
  const pending = await rejected(loadEmbeddingModelComponents(pendingModule, { modelId }));
  const pendingOwner = pending.cleanupErrors[0].transformersResourceOwner;
  assert.equal(pending.cause, pendingStartup);
  assert.equal(retainedTokenizerCloses, 0, 'unsettled native startup retains its admitted tokenizer');
  await rejected(pendingOwner.release()); assert.equal(retainedTokenizerCloses, 0);
  externalClosed = true; await pendingOwner.release();
  assert.equal(pending.cacheOwnershipReleased(), true);
  assert.equal(retainedTokenizerCloses, 1); assert.equal(retainedModelLoads, 1);

  // Pipeline construction is part of acquisition: once both components exist,
  // a constructor failure closes each original resource in reverse order.
  const constructionFailure = Object.freeze(new Error('original pipeline construction failure'));
  const constructionCloses = [];
  const constructionModule = makeModule({
    tokenizer: Object.assign(() => ({}), { dispose() { constructionCloses.push('tokenizer'); } }),
    model: Object.assign(async () => ({}), { dispose() { constructionCloses.push('model'); } }),
    Pipeline: class { constructor() { throw constructionFailure; } }
  });
  await assert.rejects(loadEmbeddingModelComponents(constructionModule, { modelId }), error => error === constructionFailure);
  assert.deepEqual(constructionCloses, ['model', 'tokenizer']);

  // Cache lifetime captures the pipeline disposer. Its retry must reconcile the
  // same component owner rather than reload or consult replacement methods.
  let retryCloses = 0, retryLoads = 0, retryTokenizerCloses = 0;
  const retryModel = Object.assign(async () => ({}), { dispose() { retryCloses++; if (retryCloses === 1) throw cleanupFailure; } });
  const retryLoaded = await loadEmbeddingModelComponents(makeModule({ model: retryModel,
    tokenizer: Object.assign(() => ({}), { dispose() { retryTokenizerCloses++; } }), onModel: () => { retryLoads++; } }), { modelId });
  const pipelineOwner = captureTransformersResource(retryLoaded.pipeline);
  const retryFailure = await rejected(pipelineOwner.retire());
  assert.equal(retryFailure.cacheOwnershipReleased(), false);
  retryModel.dispose = () => assert.fail('pipeline retry retains original model disposer');
  await pipelineOwner.release();
  assert.equal(retryFailure.cacheOwnershipReleased(), true);
  assert.equal(retryCloses, 2); assert.equal(retryTokenizerCloses, 1); assert.equal(retryLoads, 1);

  // Prefetch cancellation after acquisition must close both components before
  // preserving the original reason, without entering registry/publication.
  const controller = new AbortController(), cancellation = Object.freeze(new Error('cancelled during text acquisition'));
  const cancellationCloses = [];
  const cancellationModule = makeModule({
    tokenizer: Object.assign(() => ({}), { dispose() { cancellationCloses.push('tokenizer'); } }),
    model: Object.assign(async () => ({}), { dispose() { cancellationCloses.push('model'); } }),
    onModel: () => controller.abort(cancellation)
  });
  cancellationModule.ModelRegistry = { get_model_files: () => assert.fail('cancelled acquisition cannot enter publication') };
  await assert.rejects(prefetchEmbeddingModel(cancellationModule, { modelId, modelsDir, signal: controller.signal }),
    error => error.name === 'AbortError' && error.cause === cancellation);
  assert.deepEqual(cancellationCloses, ['model', 'tokenizer']);
  assert.deepEqual({ ...env }, initialEnvironment, 'component admission must not change global Transformers policy');
  assert.deepEqual(new Set(getPendingTransformersResourceOwners()), initialOwners);
} finally {
  for (const owner of getPendingTransformersResourceOwners()) if (!initialOwners.has(owner)) await owner.release().catch(() => {});
}
console.log('Feature extraction component admission, original cleanup and cancellation controls passed.');
