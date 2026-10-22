import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scoreLocalCrossEncoderPairs } from '../../../src/retrieval/rerankers/cross-encoder-scoring.js';

// Inert dependencies exercise the actual adapter's source/pair/disposal owner.
// They do not load or qualify any model, tokenizer or native runtime.
const profile = { maxQueryTokens: 8, maxPassageChars: 64, maxTotalChars: 128,
  maxPairTokens: 12, maxTotalTokens: 24 };
const members = [{ file: 'a.js', chunkUid: 'a', start: 0, end: 2 }, { file: 'b.js', chunkUid: 'b', start: 0, end: 2 }];
const sourceContext = { generation: 'selected-generation', repoScope: 'fixture', mode: 'code' };
const text = '😀', contentDigest = createHash('sha256').update(text).digest('hex');
let calls = 0, disposed = 0, loaded = 0;
class InertTensor {
  constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
  dispose() { disposed++; }
}
const tokenizer = (query, options) => {
  assert.equal(query, 'query'); assert.equal(options.text_pair, text); assert.equal(options.truncation, false);
  return { input_ids: [101, 7, 102, 9, 102], attention_mask: [1, 1, 1, 1, 1], token_type_ids: [0, 0, 0, 1, 1] };
};
tokenizer.encode = () => [7];
const loadSource = async ({ key, generation, hit }) => {
  loaded++;
  return { key, generation, complete: true, offsetUnit: 'utf16-code-unit', start: hit.start, end: hit.end, text, contentDigest };
};
const session = { inputNames: ['input_ids', 'attention_mask', 'token_type_ids'], run: async (feeds, names) => {
  calls++; assert.deepEqual(names, ['logits']); assert.deepEqual(feeds.input_ids.dims, [1, 5]);
  assert.deepEqual([...feeds.token_type_ids.data], [0n, 0n, 0n, 1n, 1n]);
  return { logits: { type: 'float32', data: new Float32Array([0]), dims: [1, 1], dispose() { disposed++; } } };
} };
const options = { profile, query: 'query', members, sourceContext, loadSource, tokenizer, session,
  Tensor: InertTensor, pendingTensors: new Set() };
assert.deepEqual(await scoreLocalCrossEncoderPairs(options), [{ index: 0, score: 0.5 }, { index: 1, score: 0.5 }]);
assert.equal(calls, 2); assert.equal(disposed, 8); assert.equal(options.pendingTensors.size, 0);
for (const change of [source => ({ ...source, key: 'foreign' }), source => ({ ...source, generation: 'stale' }),
  source => ({ ...source, complete: false }), source => ({ ...source, offsetUnit: 'utf8-byte' }),
  source => ({ ...source, text: '?' }), source => ({ ...source, contentDigest: 'f'.repeat(64) }),
  source => ({ ...source, end: 1 })]) {
  const before = calls;
  await assert.rejects(scoreLocalCrossEncoderPairs({ ...options,
    loadSource: async input => change(await loadSource(input)) }), /stale, partial or unqualified/);
  assert.equal(calls, before, 'unqualified source text never reaches the model seam');
}
await assert.rejects(scoreLocalCrossEncoderPairs({ ...options, members: [members[0], members[0]] }), /unique stable/);
for (const tightened of [{ maxQueryTokens: 0 }, { maxPairTokens: 4 }, { maxTotalTokens: 4 }, { maxTotalChars: 1 }]) {
  await assert.rejects(scoreLocalCrossEncoderPairs({ ...options, profile: { ...profile, ...tightened } }), /allowance exceeded/);
}
const controller = new AbortController(); controller.abort(); const beforeLoad = loaded;
await assert.rejects(scoreLocalCrossEncoderPairs({ ...options, signal: controller.signal }), { name: 'AbortError' });
assert.equal(loaded, beforeLoad);
const during = new AbortController(), beforeInference = calls;
await assert.rejects(scoreLocalCrossEncoderPairs({ ...options, signal: during.signal,
  loadSource: async input => { const result = await loadSource(input); during.abort(); return result; } }), { name: 'AbortError' });
assert.equal(calls, beforeInference, 'source-load cancellation cannot publish successful model scores');
const broken = { type: 'float32', dims: [1, 1], data: new Float32Array([0]), dispose() { throw new Error('dispose pending'); } };
await assert.rejects(scoreLocalCrossEncoderPairs({ ...options, members: [members[0]],
  session: { ...session, run: async () => ({ logits: broken }) } }), error => error.cacheOwnershipPending === true);
assert(options.pendingTensors.has(broken), 'failed tensor disposal remains owned for adapter cleanup');
console.log('Local cross-encoder authoritative source, actual pair formatting, cancellation and tensor ownership assertions complete');
