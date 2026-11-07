import assert from 'node:assert/strict';
import { createPreparedTextEncoder } from '../../../src/shared/embedding-prepared.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { getPendingTransformersResourceOwners, captureTransformersResource } from '../../../src/shared/embedding-transformers-resources.js';

// Actual prepared encoder with inert constructors; no native sessions/model.
const profile = resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX', { dimensions: 128 });
const leaf = Object.freeze(new Error('original tensor leaf'));
const cleanup = Object.freeze(new AggregateError([leaf], 'frozen tensor cleanup failure', { cause: leaf }));
const primary = Object.freeze(new AggregateError([leaf], 'frozen model/constructor failure', { cause: leaf }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const rejected = work => work.then(() => assert.fail('expected retained prepared owner'), error => error);
const fixtures = [];
const fixture = (options = {}) => {
  const value = { tensors: [], allocations: 0, models: 0, tokenizers: 0, calls: 0, ...options };
  class Tensor {
    constructor(type, data, dims) {
      value.allocations++; if (value.failConstructorAt === value.allocations) throw primary;
      Object.assign(this, { type, data, dims, closes: 0, errors: [] }); value.tensors.push(this);
      if (value.failInputClose && value.allocations === 1) this.errors.push(cleanup);
    }
    async dispose() { this.closes++; if (this.errors.length) throw this.errors.shift(); }
  }
  const tokenizer = async (texts, request) => {
    const ids = texts.map(() => [101, 2, 102]), masks = ids.map(row => row.map(() => 1));
    if (request.return_tensor === false) return { input_ids: ids, attention_mask: masks };
    return { input_ids: new Tensor('int64', BigInt64Array.from(ids.flat(), BigInt), [texts.length, 3]),
      attention_mask: new Tensor('int64', BigInt64Array.from(masks.flat(), BigInt), [texts.length, 3]) };
  };
  tokenizer.dispose = async function () { assert.equal(this, tokenizer); value.tokenizers++; };
  const model = async inputs => {
    value.calls++; value.entered?.resolve(); if (value.gate) await value.gate.promise;
    if (Object.hasOwn(value, 'modelError')) throw value.modelError;
    const count = inputs.input_ids.dims[0], data = new Float32Array(count * 768);
    for (let row = 0; row < count; row++) data[row * 768] = 1;
    const output = new Tensor('float32', data, [count, value.invalidOutput ? 767 : 768]);
    if (value.failOutputClose) output.errors.push(cleanup);
    value.output = output;
    return { sentence_embedding: output, output_alias: output, input_alias: inputs.input_ids };
  };
  model.dispose = async function () { assert.equal(this, model); value.models++; };
  if (value.profileGate) model.sessions = { model: { endProfiling: async () => {
    value.profileEntered.resolve(); await value.profileGate.promise;
  } } };
  value.encoder = createPreparedTextEncoder({ tokenizer, model, Tensor, profile,
    sessionOptions: value.profileGate ? { enableProfiling: true } : {} });
  value.model = model; value.tokenizer = tokenizer; fixtures.push(value); return value;
};
let externalClosed = false;
try {
  const healthy = fixture(), rows = await healthy.encoder.prepare(['one']);
  assert.equal((await healthy.encoder.embedPrepared(rows))[0].length, 128);
  assert.equal(healthy.tensors.length, 3); assert.ok(healthy.tensors.every(tensor => tensor.closes === 1), 'input/output aliases dispose once');
  const copied = await healthy.encoder(['direct tokenizer tensors']); assert.equal(copied[0][0], 1);
  assert.ok(healthy.tensors.every(tensor => tensor.closes === 1));
  healthy.model.dispose = () => assert.fail('model method captured before inference');
  healthy.tokenizer.dispose = () => assert.fail('tokenizer method captured before inference');
  await healthy.encoder.dispose(); await healthy.encoder.dispose(); assert.equal(healthy.models, 1); assert.equal(healthy.tokenizers, 1);

  const pending = fixture({ failOutputClose: true }), pendingRows = await pending.encoder.prepare(['pending']);
  const tensorFailure = await rejected(pending.encoder.embedPrepared(pendingRows));
  const tensorScope = tensorFailure.transformersResourceOwner;
  assert.equal(tensorScope.kind, 'prepared encoder operation tensors');
  const outputOwner = tensorScope.resources.find(owner => owner.resource === pending.output);
  assert.equal(outputOwner.lastError.cause, cleanup); assert.equal(pending.output.closes, 1);
  pending.output.dispose = () => assert.fail('failed output keeps original captured dispose');
  assert.equal(await rejected(pending.encoder.embedPrepared(pendingRows)), tensorFailure, 'pending cleanup stops new inference admission');
  assert.equal(pending.calls, 1);
  const firstDisposal = await rejected(pending.encoder.dispose());
  assert.equal(pending.output.closes, 1, 'first shutdown reports already observed cleanup without retry');
  assert.equal(pending.models, 0); assert.equal(pending.tokenizers, 0, 'pending tensors keep model/tokenizer alive');
  await outputOwner.release(); assert.equal(pending.output.closes, 2);
  await pending.encoder.dispose();
  assert.equal(tensorFailure.cacheOwnershipReleased(), true); assert.equal(firstDisposal.cacheOwnershipReleased(), true);
  assert.equal(pending.models, 1); assert.equal(pending.tokenizers, 1);
  assert.ok(pending.tensors.filter(tensor => tensor !== pending.output).every(tensor => tensor.closes === 1));

  const construction = fixture({ failConstructorAt: 2 }), constructionRows = await construction.encoder.prepare(['partial']);
  assert.equal(await rejected(construction.encoder.embedPrepared(constructionRows)), primary);
  assert.equal(construction.calls, 0); assert.equal(construction.tensors.length, 1); assert.equal(construction.tensors[0].closes, 1);
  await construction.encoder.dispose();

  const primaryAndCleanup = fixture({ modelError: primary, failInputClose: true });
  const combinedFailure = await rejected(primaryAndCleanup.encoder(['primary and cleanup']));
  assert.equal(combinedFailure.cause, primary); assert.equal(combinedFailure.errors[0], primary);
  assert.equal(combinedFailure.cleanupErrors[0].transformersResourceOwner.kind, 'prepared encoder operation tensors');
  assert.equal(primary.cause, leaf); assert.deepEqual(primary.errors, [leaf]); assert.equal(primary.cleanupErrors, undefined);
  await rejected(primaryAndCleanup.encoder.dispose()); assert.equal(primaryAndCleanup.tensors[0].closes, 1);
  await primaryAndCleanup.encoder.dispose(); assert.equal(primaryAndCleanup.tensors[0].closes, 2);
  assert.equal(primaryAndCleanup.calls, 1); assert.equal(combinedFailure.cacheOwnershipReleased(), true);

  const malformed = fixture({ invalidOutput: true });
  const malformedFailure = await rejected(malformed.encoder(['malformed output']));
  assert.equal(malformedFailure.code, 'ERR_EMBEDDING_OUTPUT');
  assert.match(malformedFailure.message, /tensor data length disagrees with its shape/);
  assert.ok(malformed.tensors.every(tensor => tensor.closes === 1), 'invalid output still releases every observed input/output');
  await malformed.encoder.dispose();

  const unknown = new Error('native model work is not yet settled');
  Object.defineProperties(unknown, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() {
    assert.equal(this, unknown); return externalClosed;
  } } }); Object.freeze(unknown);
  const blocked = fixture({ modelError: unknown });
  const blockedFailure = await rejected(blocked.encoder(['native pending']));
  assert.equal(blockedFailure.cause, unknown); assert.ok(blocked.tensors.every(tensor => tensor.closes === 0));
  await rejected(blocked.encoder.dispose()); assert.equal(blocked.models, 0); assert.equal(blocked.tokenizers, 0);
  externalClosed = true; await blocked.encoder.dispose();
  assert.ok(blocked.tensors.every(tensor => tensor.closes === 1)); assert.equal(blocked.calls, 1);
  assert.equal(blockedFailure.cacheOwnershipReleased(), true);

  const ownedRetry = fixture({ failOutputClose: true }), ownedRows = await ownedRetry.encoder.prepare(['known producer reconciliation']);
  const outer = captureTransformersResource(ownedRetry.encoder);
  await rejected(ownedRetry.encoder.embedPrepared(ownedRows));
  await rejected(outer.retire()); assert.equal(ownedRetry.models, 0);
  await outer.release(); assert.equal(ownedRetry.models, 1); assert.equal(outer.pending, false,
    'an actual prepared producer reconciles its own pending closure without repeating independently pending native disposal');

  const gate = deferred(), entered = deferred(), active = fixture({ gate, entered });
  const activeWork = active.encoder(['accepted work']); await entered.promise;
  let closed = false; const activeClose = active.encoder.dispose().then(() => { closed = true; });
  await turn(); assert.equal(closed, false); assert.equal(active.models, 0); assert.ok(active.tensors.every(tensor => tensor.closes === 0));
  gate.resolve(); await activeWork; await activeClose; assert.equal(active.models, 1); assert.equal(active.tokenizers, 1);

  const profileGate = deferred(), profileEntered = deferred(), profiling = fixture({ profileGate, profileEntered });
  const profilingWork = profiling.encoder.endProfiling(); await profileEntered.promise;
  let profilingClosed = false; const profilingClose = profiling.encoder.dispose().then(() => { profilingClosed = true; });
  await turn(); assert.equal(profilingClosed, false); assert.equal(profiling.models, 0);
  profileGate.resolve(); await profilingWork; await profilingClose; assert.equal(profiling.models, 1);
} finally {
  externalClosed = true;
  for (const value of fixtures) { value.gate?.resolve(); value.profileGate?.resolve(); for (const tensor of value.tensors) tensor.errors.length = 0; }
  await Promise.allSettled(fixtures.map(value => value.encoder.dispose()));
  for (const owner of getPendingTransformersResourceOwners()) await owner.release().catch(() => {});
}
console.log('Prepared tensor/model/tokenizer accepted-work ownership controls authored; all execution deferred.');
