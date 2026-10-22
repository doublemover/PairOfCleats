import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scoreLocalCrossEncoderPairs, decodeCrossEncoderLogit } from '../../../src/retrieval/rerankers/cross-encoder-scoring.js';

// Actual scorer/output admission with inert tokenizer/session/tensor boundaries.
// Synthetic identities only; no model, native runtime, process or storage IO.
const profile = { maxQueryTokens: 8, maxPassageChars: 64, maxTotalChars: 128, maxPairTokens: 12, maxTotalTokens: 24 };
const members = [{ file: 'a.js', chunkUid: 'a', start: 0, end: 2 }], text = 'ok';
const sourceContext = { generation: 'original-output-fixture', repoScope: 'fixture', mode: 'code' };
const contentDigest = createHash('sha256').update(text).digest('hex'), all = [], finish = [];
const fixture = makeOutputs => {
  const value = { tensors: [], runs: 0, pendingTensors: new Set(), pendingTensorOwners: new Map(), makeOutputs };
  value.Tensor = class {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0 }); value.tensors.push(this); }
    dispose() { this.closes++; }
  };
  const tokenizer = () => ({ input_ids: [1, 2], attention_mask: [1, 1], token_type_ids: [0, 1] }); tokenizer.encode = () => [1];
  value.options = { profile, query: 'query', members, sourceContext, Tensor: value.Tensor, tokenizer,
    pendingTensors: value.pendingTensors, pendingTensorOwners: value.pendingTensorOwners,
    loadSource: async ({ key, generation, hit }) => ({ key, generation, complete: true,
      offsetUnit: 'utf16-code-unit', start: hit.start, end: hit.end, text, contentDigest }),
    session: { inputNames: ['input_ids', 'attention_mask', 'token_type_ids'], run: async feeds => {
      value.runs++; return value.makeOutputs(value, feeds); } } };
  all.push(value); return value;
};
const output = value => new value.Tensor('float32', new Float32Array([0]), [1, 1]);
const rejected = async value => {
  try { await scoreLocalCrossEncoderPairs(value.options); assert.fail('expected original output admission failure'); }
  catch (error) { return error; }
};
try {
  const ordinary = fixture((value, feeds) => {
    const logits = output(value), extra = output(value), outputs = { logits, alias: feeds.input_ids };
    Object.defineProperty(outputs, 'nonenumerable', { value: extra }); outputs[Symbol('original output alias')] = logits; return outputs;
  });
  assert.deepEqual(await scoreLocalCrossEncoderPairs(ordinary.options), [{ index: 0, score: 0.5 }]);
  assert.deepEqual(ordinary.tensors.map(tensor => tensor.closes), [1, 1, 1, 1, 1]); assert.equal(ordinary.pendingTensors.size, 0);

  const reads = { type: 0, dims: 0, data: 0 };
  const singleRead = fixture(value => {
    const logits = output(value);
    Object.defineProperties(logits, { type: { get() { reads.type++; return 'float32'; } },
      dims: { get() { reads.dims++; return [1, 1]; } },
      data: { get() { reads.data++; return new Float32Array([reads.data === 1 ? 0 : 100]); } } });
    return { logits };
  });
  assert.deepEqual(await scoreLocalCrossEncoderPairs(singleRead.options), [{ index: 0, score: 0.5 }]); assert.deepEqual(reads, { type: 1, dims: 1, data: 1 });
  const inheritedDims = new Array(2); Object.setPrototypeOf(inheritedDims, Object.create(Array.prototype, { 0: { value: 1 }, 1: { value: 1 } }));
  assert.throws(() => decodeCrossEncoderLogit({ type: 'float32', dims: inheritedDims, data: new Float32Array([0]) }));

  // Known output tensors before and after opaque fields remain retained; no
  // unsupported getter runs or turns replacement metadata into closure proof.
  let accessorReads = 0, originalBag;
  const accessor = fixture(value => {
    originalBag = { logits: output(value) };
    Object.defineProperty(originalBag, 'opaque', { configurable: true, enumerable: true, get() { accessorReads++; throw false; } });
    Object.defineProperty(originalBag, 'later', { value: output(value) }); return originalBag;
  });
  const accessorFailure = await rejected(accessor), projection = accessorFailure.primaryError;
  assert.equal(projection.code, 'ERR_LOCAL_RERANKER_OUTPUT'); assert.equal(projection.rerankerOwner.outputs, originalBag);
  assert.equal(accessorReads, 0); assert.equal(accessor.pendingTensors.size, 5); assert.deepEqual(accessor.tensors.map(tensor => tensor.closes), [0, 0, 0, 0, 0]);
  Object.defineProperty(originalBag, 'opaque', { value: null });
  await assert.rejects(accessorFailure.rerankerOwner.close(), error => error.cacheOwnershipPending === true);
  assert.equal(projection.cacheOwnershipReleased(), false, 'later container replacement cannot complete an opaque original acquisition');

  let descriptorReads = 0, descriptorBag;
  const descriptor = fixture(value => {
    const actual = { inaccessible: output(value), logits: output(value), later: output(value) };
    descriptorBag = new Proxy(actual, { getOwnPropertyDescriptor(target, key) { if (key === 'inaccessible') { descriptorReads++; throw undefined; }
      return Reflect.getOwnPropertyDescriptor(target, key); } }); return descriptorBag;
  });
  const descriptorFailure = await rejected(descriptor), descriptorProjection = descriptorFailure.primaryError;
  assert.equal(descriptorProjection.cause, undefined); assert.equal(descriptorProjection.rerankerOwner.outputs, descriptorBag);
  assert.equal(descriptorReads, 1); assert.equal(descriptor.pendingTensors.size, 5);
  assert.deepEqual(descriptor.tensors.map(tensor => tensor.closes), [0, 0, 0, 0, 0, 0]);
  await assert.rejects(descriptorFailure.rerankerOwner.close()); assert.equal(descriptorReads, 1);

  const malformedArray = fixture(value => [output(value), output(value)]), arrayFailure = await rejected(malformedArray);
  assert.equal(arrayFailure.code, 'ERR_LOCAL_RERANKER_OUTPUT'); assert.deepEqual(malformedArray.tensors.map(tensor => tensor.closes), [1, 1, 1, 1, 1]);

  let outputDisposeReads = 0, unclosable;
  const capturedFailure = Object.freeze(new AggregateError([false], 'original output method capture', { cause: false }));
  const failedCapture = fixture(value => {
    const logits = output(value); unclosable = output(value);
    Object.defineProperty(unclosable, 'dispose', { get() { outputDisposeReads++; throw capturedFailure; } });
    return { logits, unclosable, later: output(value) };
  });
  const outputFailure = await rejected(failedCapture);
  assert.equal(outputFailure.primaryError.cause, capturedFailure); assert.equal(outputFailure.primaryError.errors[0], capturedFailure);
  assert.equal(failedCapture.pendingTensors.size, 1); assert(failedCapture.pendingTensors.has(unclosable));
  assert.deepEqual(failedCapture.tensors.map(tensor => tensor.closes), [1, 1, 1, 1, 0, 1]);
  await assert.rejects(outputFailure.rerankerOwner.close()); assert.equal(outputDisposeReads, 1);
  assert.equal(capturedFailure.cause, false); assert.deepEqual(capturedFailure.errors, [false]);

  let overflowBag;
  const overflow = fixture(value => {
    overflowBag = { logits: output(value) }; for (let index = 0; index < 64; index++) overflowBag[`extra${index}`] = output(value); return overflowBag;
  });
  const overflowFailure = await rejected(overflow);
  assert.equal(overflowFailure.primaryError.rerankerOwner.outputs, overflowBag);
  assert.equal(overflow.pendingTensorOwners.size, 67); assert.equal(overflow.tensors.length, 68);
  assert(overflow.tensors.every(tensor => tensor.closes === 0)); assert.equal(overflowFailure.cacheOwnershipReleased(), false);

  let nativeSettled = false, replaced = false; finish.push(() => { nativeSettled = true; });
  const original = Object.freeze(Object.defineProperty(new Error('original logit read work'), 'cacheOwnershipReleased', {
    get() { return replaced ? () => true : function() { assert.equal(this, original); return nativeSettled; }; }
  }));
  const readFailure = fixture(value => { const logits = output(value); Object.defineProperty(logits, 'data', { get() { throw original; } }); return { logits, later: output(value) }; });
  const originalFailure = await rejected(readFailure); assert.equal(originalFailure.primaryError, original);
  assert.equal(readFailure.pendingTensors.size, 5); assert.deepEqual(readFailure.tensors.map(tensor => tensor.closes), [0, 0, 0, 0, 0]);
  replaced = true; await assert.rejects(originalFailure.rerankerOwner.close());
  nativeSettled = true; await originalFailure.rerankerOwner.close(); assert.deepEqual(readFailure.tensors.map(tensor => tensor.closes), [1, 1, 1, 1, 1]);
  assert.equal(originalFailure.cacheOwnershipReleased(), true);

  // Capture failures are published after the exact object/capability is stored,
  // and input capture failure prevents actual inference from starting at all.
  const input = fixture(value => ({ logits: output(value) })); let inputDisposeReads = 0;
  input.options.Tensor = class {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0 }); input.tensors.push(this);
      Object.defineProperty(this, 'dispose', { get() { inputDisposeReads++; throw undefined; } }); }
  };
  const inputFailure = await rejected(input); assert.equal(inputFailure.primaryError, undefined); assert.equal(input.runs, 0);
  assert.equal(input.pendingTensors.size, 1); assert.equal(inputDisposeReads, 1);
  await assert.rejects(inputFailure.rerankerOwner.close()); assert.equal(inputDisposeReads, 1);
} finally {
  for (const complete of finish) complete();
  for (const value of all) for (const owner of value.pendingTensorOwners.values()) await owner.close().catch(() => {});
}
console.log('Actual cross-encoder original output/tensor projection controls authored; execution deferred.');
