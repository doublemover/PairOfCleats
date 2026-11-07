import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scoreLocalCrossEncoderPairs } from '../../../src/retrieval/rerankers/cross-encoder-scoring.js';
import { captureCrossEncoderRuntime } from '../../../src/retrieval/rerankers/cross-encoder-inputs.js';

// Actual scorer/input/output/tensor owners; every runtime/source seam is inert.
const profile = { maxQueryTokens: 8, maxPassageChars: 64, maxTotalChars: 128, maxPairTokens: 12, maxTotalTokens: 24 };
const context = { generation: 'original-input-generation', repoScope: 'fixture', mode: 'code' };
const members = [{ chunkUid: 'a', file: 'a.js', start: 0, end: 2 }, { chunkUid: 'b', file: 'b.js', start: 0, end: 2 }];
const text = 'ok', contentDigest = createHash('sha256').update(text).digest('hex');
const pair = () => ({ input_ids: [101, 3, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 1] });
const fixtures = [];
const make = () => {
  const value = { runs: 0, loads: 0, tensors: [], pairs: [], names: ['input_ids', 'attention_mask', 'token_type_ids'],
    context: { ...context }, pendingTensors: new Set(), pendingTensorOwners: new Map() };
  const tokenizer = function(query, options) { assert.equal(this, undefined); value.pairs.push(options.text_pair); return value.pair ? value.pair() : pair(); };
  tokenizer.encode = function() { assert.equal(this, tokenizer); return value.query ? value.query() : [3]; };
  value.tokenizer = tokenizer;
  value.session = { inputNames: value.names, run: async function(feeds, outputs) {
    assert.equal(this, value.session); value.runs++; assert.deepEqual(outputs, ['logits']);
    assert.deepEqual([...feeds.input_ids.data], [101n, 3n, 102n]);
    return { logits: new value.Tensor('float32', new Float32Array([0]), [1, 1]) };
  } };
  value.Tensor = class {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims, closes: 0 }); value.tensors.push(this); }
    dispose() { this.closes++; }
  };
  value.options = { profile, query: 'query', members, sourceContext: value.context, tokenizer, session: value.session, Tensor: value.Tensor,
    pendingTensors: value.pendingTensors, pendingTensorOwners: value.pendingTensorOwners,
    loadSource: async input => { value.loads++; value.load?.(input); return value.source ? value.source(input) : { key: input.key,
      generation: input.generation, complete: true, offsetUnit: 'utf16-code-unit', start: input.hit.start, end: input.hit.end, text, contentDigest }; } };
  fixtures.push(value); return value;
};
const rejected = async value => { try { await scoreLocalCrossEncoderPairs(value.options); } catch (error) { return error; } assert.fail('expected original input admission failure'); };
try {
  const original = make(); let encodeReads = 0, runReads = 0, namesReads = 0;
  const encode = original.tokenizer.encode, run = original.session.run;
  Object.defineProperty(original.tokenizer, 'encode', { configurable: true, get() { encodeReads++; return encode; } });
  Object.defineProperties(original.session, { run: { configurable: true, get() { runReads++; return run; } },
    inputNames: { configurable: true, get() { namesReads++; return original.names; } } });
  original.load = () => {
    Object.defineProperty(original.tokenizer, 'encode', { value: () => assert.fail('later encode is not original runtime authority') });
    Object.defineProperty(original.session, 'run', { value: () => assert.fail('later native callback is not original runtime authority') });
    Object.defineProperty(original.session, 'inputNames', { value: ['foreign-input'] }); original.names[0] = 'foreign-input';
    original.context.generation = 'replacement-generation'; original.context.mode = 'prose'; original.context.repoScope = 'foreign';
  };
  assert.deepEqual(await scoreLocalCrossEncoderPairs(original.options), [{ index: 0, score: .5 }, { index: 1, score: .5 }]);
  assert.deepEqual([encodeReads, runReads, namesReads], [1, 1, 1]); assert.equal(original.runs, 2); assert(original.tensors.every(tensor => tensor.closes === 1));

  const captured = make(), originalRuntime = captureCrossEncoderRuntime(captured.tokenizer, captured.session);
  captured.options.capturedRuntime = originalRuntime; captured.session.run = captured.tokenizer.encode = () => assert.fail('original branded producer cannot adopt later fields');
  await scoreLocalCrossEncoderPairs(captured.options); assert.equal(captured.runs, 2);
  for (const replace of [value => { value.options.capturedRuntime = { ...captureCrossEncoderRuntime(value.tokenizer, value.session) }; },
    value => { value.options.capturedRuntime = captureCrossEncoderRuntime(value.tokenizer, value.session); value.options.session = { ...value.session }; },
    value => { value.options.capturedRuntime = false; }]) {
    const lookalike = make(); replace(lookalike); await rejected(lookalike); assert.equal(lookalike.loads, 0); assert.equal(lookalike.runs, 0);
  }

  const noIterators = make(); let iteratorCalls = 0, someCalls = 0;
  noIterators.pair = () => {
    const encoded = pair();
    for (const row of Object.values(encoded)) {
      row.some = () => { someCalls++; return false; }; row[Symbol.iterator] = () => { iteratorCalls++; throw new Error('row iteration is not input authority'); };
    }
    return encoded;
  };
  noIterators.names[Symbol.iterator] = () => assert.fail('session metadata iterator cannot supply replacement native input names');
  await scoreLocalCrossEncoderPairs(noIterators.options); assert.equal(iteratorCalls, 0); assert.equal(someCalls, 0); assert.equal(noIterators.runs, 2);

  let getterReads = 0;
  for (const change of [encoded => { Object.defineProperty(encoded.input_ids, 0, { get() { getterReads++; return 101; } }); },
    encoded => { delete encoded.attention_mask[1]; }, encoded => { encoded.attention_mask[1] = 2; },
    encoded => { encoded.input_ids[0] = -1; encoded.input_ids.some = () => false; },
    encoded => { Object.defineProperty(encoded, 'attention_mask', { get() { getterReads++; return [1, 1, 1]; } }); }]) {
    const invalid = make(); invalid.pair = () => { const encoded = pair(); change(encoded); return encoded; };
    await rejected(invalid); assert.equal(invalid.runs, 0); assert.equal(invalid.tensors.length, 0);
  }
  assert.equal(getterReads, 0, 'input accessors are not executed to manufacture token evidence');
  const inherited = make(); inherited.pair = () => Object.create(pair()); await rejected(inherited); assert.equal(inherited.runs, 0);
  for (const query of [() => new Array(1), () => [-1], () => [NaN], () => [Number.MAX_SAFE_INTEGER + 1]]) {
    const invalid = make(); invalid.query = query; await rejected(invalid); assert.equal(invalid.loads, 0); assert.equal(invalid.runs, 0);
  }
  const duplicates = make(); duplicates.names = duplicates.session.inputNames = ['input_ids', 'input_ids', 'attention_mask'];
  await rejected(duplicates); assert.equal(duplicates.loads, 0); assert.equal(duplicates.runs, 0);

  const sourceGetter = make(); let sourceReads = 0;
  sourceGetter.source = input => Object.defineProperty({ key: input.key, generation: input.generation, complete: true,
    offsetUnit: 'utf16-code-unit', start: 0, end: 2, contentDigest }, 'text', { get() { sourceReads++; return text; } });
  await rejected(sourceGetter); assert.equal(sourceReads, 0); assert.equal(sourceGetter.runs, 0);
  const digestObject = make(); digestObject.source = input => ({ key: input.key, generation: input.generation, complete: true,
    offsetUnit: 'utf16-code-unit', start: 0, end: 2, text, contentDigest: { toString() { assert.fail('digest objects cannot execute as source identity'); } } });
  await rejected(digestObject); assert.equal(digestObject.runs, 0);
  const ownSource = make(); let descriptors = 0;
  ownSource.source = input => new Proxy({ key: input.key, generation: input.generation, complete: true,
    offsetUnit: 'utf16-code-unit', start: 0, end: 2, text, contentDigest }, { get(target, name) {
    if (name === 'then') return undefined; // Promise resolution checks thenability before source admission.
    assert.fail('source value getter cannot substitute between hash and token formatting'); },
  getOwnPropertyDescriptor(target, name) { descriptors++; return Reflect.getOwnPropertyDescriptor(target, name); } });
  await scoreLocalCrossEncoderPairs(ownSource.options); assert.equal(descriptors, 16); assert.deepEqual(ownSource.pairs, [text, text]);

  let ready = false;
  const pending = Object.freeze(Object.defineProperty(new Error('independent original token inspection work'), 'cacheOwnershipReleased', { value: () => ready }));
  const trapped = make(); trapped.pair = () => new Proxy(pair(), { getOwnPropertyDescriptor() { throw pending; } });
  assert.equal(await rejected(trapped), pending); assert.equal(trapped.runs, 0); assert.equal(trapped.tensors.length, 0);
  assert.equal(pending.cacheOwnershipReleased(), false); ready = true; assert.equal(pending.cacheOwnershipReleased(), true);
} finally {
  for (const value of fixtures) for (const resource of value.pendingTensorOwners.values()) { try { await resource.close(); } catch {} }
}
console.log('Actual cross-encoder original runtime/passive token/source controls authored; execution deferred.');
