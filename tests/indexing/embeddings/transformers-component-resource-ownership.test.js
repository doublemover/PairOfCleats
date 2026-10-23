import assert from 'node:assert/strict';
import { loadEmbeddingModelComponents } from '../../../src/shared/embedding-model-loading.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { captureTransformersResource, getPendingTransformersResourceOwners } from '../../../src/shared/embedding-transformers-resources.js';
import { createPreparedTextEncoder } from '../../../src/shared/embedding-prepared.js';

// Actual acquisition/prepared constructors, inert JS components, no native load.
const profile = resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX', { dimensions: 128 });
const leaf = Object.freeze(new Error('original frozen component leaf'));
const primary = Object.freeze(Object.assign(new AggregateError([leaf], 'frozen native startup failure', { cause: leaf }), { code: 'CONTROLLED_INIT' }));
const cleanup = Object.freeze(new AggregateError([leaf], 'frozen tokenizer/model cleanup failure', { cause: leaf }));
const rejected = work => work.then(() => assert.fail('expected retained native component failure'), error => error);
const originals = new Set(getPendingTransformersResourceOwners());
const encoders = [];
let externalClosed = false;
try {
  let calls = 0, tokenizerCloses = 0, reads = 0;
  const tokenizer = () => ({});
  Object.defineProperty(tokenizer, 'dispose', { configurable: true, get() {
    reads++; return async function () {
      assert.equal(this, tokenizer); tokenizerCloses++; if (tokenizerCloses === 1) throw cleanup;
    };
  } });
  const mod = { env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
    AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2' }) },
    AutoTokenizer: { from_pretrained: async () => tokenizer },
    AutoModel: { from_pretrained: async (_, options) => {
      calls++; assert.equal(options.revision, profile.revision); assert.equal(options.dtype, profile.dtype);
      assert.equal(options.config.vision_config, null); assert.equal(options.config.audio_config, null); throw primary;
    } } };
  const failure = await rejected(loadEmbeddingModelComponents(mod, { modelId: 'controlled-components', modelProfile: profile }));
  assert.equal(failure.cause, primary); assert.equal(failure.code, 'CONTROLLED_INIT');
  assert.equal(primary.cause, leaf); assert.deepEqual(primary.errors, [leaf]); assert.equal(primary.cleanupErrors, undefined);
  const scope = failure.cleanupErrors[0].transformersResourceOwner;
  assert.equal(scope.resources[0].resource, tokenizer); assert.equal(scope.resources[0].lastError.cause, cleanup);
  assert.equal(reads, 1); assert.equal(calls, 1); assert.equal(tokenizerCloses, 1);
  Object.defineProperty(tokenizer, 'dispose', { value: () => assert.fail('keep original tokenizer dispose') });
  await scope.release(); assert.equal(tokenizerCloses, 2); assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), true);

  const unknown = new Error('model creation retained an original external native owner');
  Object.defineProperties(unknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, unknown); return externalClosed;
  } } }); Object.freeze(unknown);
  let partialCloses = 0;
  mod.AutoTokenizer.from_pretrained = async () => ({ dispose: async () => { partialCloses++; } });
  mod.AutoModel.from_pretrained = async () => { calls++; throw unknown; };
  const unknownFailure = await rejected(loadEmbeddingModelComponents(mod, { modelId: 'controlled-pending', modelProfile: profile }));
  const unknownScope = unknownFailure.cleanupErrors[0].transformersResourceOwner;
  assert.equal(unknownFailure.cause, unknown); assert.equal(partialCloses, 0, 'pending model construction keeps the acquired tokenizer alive');
  await rejected(unknownScope.release()); assert.equal(partialCloses, 0);
  externalClosed = true; await unknownScope.release(); assert.equal(unknownFailure.cacheOwnershipReleased(), true); assert.equal(partialCloses, 1);
  assert.equal(calls, 2, 'partial acquisition reconciliation never calls the model factory');

  let modelCloses = 0, exactTokenizerCloses = 0;
  const exactTokenizer = Object.assign(() => ({}), { dispose: async () => {
    exactTokenizerCloses++; if (exactTokenizerCloses === 1) throw cleanup;
  } });
  const model = Object.assign(async () => ({}), { dispose: async () => { modelCloses++; if (modelCloses === 1) throw cleanup; } });
  mod.AutoTokenizer.from_pretrained = async () => exactTokenizer; mod.AutoModel.from_pretrained = async () => model;
  const acquired = await loadEmbeddingModelComponents(mod, { modelId: 'controlled-success', modelProfile: profile });
  model.dispose = () => assert.fail('keep original acquired model dispose');
  exactTokenizer.dispose = () => assert.fail('keep original acquired tokenizer dispose');
  const encoder = createPreparedTextEncoder({ ...acquired, profile, sessionOptions: {} }); encoders.push(encoder);
  const disposal = encoder.dispose(); assert.equal(encoder.dispose(), disposal);
  const disposalFailure = await rejected(disposal);
  assert.equal(modelCloses, 1); assert.equal(exactTokenizerCloses, 1, 'tokenizer cleanup is independent of model cleanup failure');
  assert.equal(disposalFailure.transformersResourceOwner, encoder.transformersResourceOwner);
  await encoder.dispose(); assert.equal(modelCloses, 2); assert.equal(exactTokenizerCloses, 2);
  assert.equal(disposalFailure.cacheOwnershipReleased(), true); assert.equal(acquired.resourceOwner.pending, false);
  await encoder.dispose(); assert.equal(modelCloses, 2); assert.equal(exactTokenizerCloses, 2);

  for (const thrown of [undefined, null, false, 0, '']) {
    let getterCalls = 0;
    const object = Object.defineProperty({}, 'dispose', { get() { getterCalls++; throw thrown; } });
    const owner = captureTransformersResource(object, 'falsey getter control');
    const getterFailure = await rejected(owner.retire());
    assert.equal(getterFailure.cause, thrown); assert.deepEqual(getterFailure.errors, [thrown]);
    await rejected(owner.release()); assert.equal(getterCalls, 1); assert.equal(owner.pending, true);
  }
  const explicitFalse = captureTransformersResource({ dispose: async () => false });
  const falseFailure = await rejected(explicitFalse.retire());
  assert.equal(falseFailure.code, 'ERR_TRANSFORMERS_RESOURCE_UNCONFIRMED'); assert.equal(explicitFalse.pending, true);

  let disposalSettled = false, disposalCalls = 0, substitute = false;
  const disposalPending = new Error('native disposal still owns its first attempt');
  Object.defineProperties(disposalPending, { cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { get() {
    return substitute ? () => true : () => disposalSettled;
  } } }); Object.freeze(disposalPending);
  const disposalOwner = captureTransformersResource({ dispose() { if (++disposalCalls === 1) throw disposalPending; } });
  await rejected(disposalOwner.retire()); substitute = true;
  await rejected(disposalOwner.release()); assert.equal(disposalCalls, 1, 'explicit retry cannot repeat unsettled native disposal');
  disposalSettled = true; await disposalOwner.release(); assert.equal(disposalCalls, 2); assert.equal(disposalOwner.pending, false);
} finally {
  externalClosed = true;
  await Promise.allSettled(encoders.map(encoder => encoder.dispose()));
  for (const owner of getPendingTransformersResourceOwners()) if (!originals.has(owner)) await owner.release().catch(() => {});
}
console.log('Actual Transformers partial component/exact cleanup controls authored; all execution deferred.');
