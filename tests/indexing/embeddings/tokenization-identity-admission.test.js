import assert from 'node:assert/strict';
import { createPreparedTokenRows, createTokenizationIdentity, prepareTokenRowsWithCache,
  tokenizeBatchWithCache } from '../../../src/shared/onnx-embeddings/tokenization.js';

const cache = { enabled: true, maxEntries: 8, cache: new Map() }, calls = [], measurements = {};
const tokenizer = (texts, options) => {
  calls.push({ texts, options });
  const length = options.truncation ? options.max_length ?? 3 : 5;
  return { input_ids: texts.map(() => Array(length).fill(7)), attention_mask: texts.map(() => Array(length).fill(1)),
    token_type_ids: texts.map(() => Array(length).fill(2)) };
};
const prepare = options => prepareTokenRowsWithCache({ tokenizer, texts: ['same'], tokenizationCache: cache, measurements, ...options });
const short = prepare({ maxLength: 2 });
assert.equal(short[0].input_ids.length, 2);
assert.equal(prepare({ maxLength: 4 })[0].input_ids.length, 4);
assert.equal(prepare({ maxLength: 2, truncation: false })[0].input_ids.length, 5);
assert.deepEqual(prepare({ maxLength: 2, wantsTokenTypeIds: true })[0].token_type_ids, [2, 2]);
const secondTokenizer = texts => ({ input_ids: texts.map(() => [99]) });
assert.deepEqual(prepare({ tokenizer: secondTokenizer, maxLength: 2 })[0].input_ids, [99]);
assert.equal(prepare({ maxLength: 2 })[0], short[0]);
assert.equal(calls.length, 4); assert.equal(measurements.tokenCacheRowHits, 1);

const retained = createPreparedTokenRows(), identity = createTokenizationIdentity({ tokenizer, maxLength: 2 });
const release = retained.retain(['same'], short, identity);
assert.equal(prepare({ maxLength: 4, preparedRows: retained })[0].input_ids.length, 4);
assert.equal(retained.stats().entries, 1, 'different preprocessing cannot consume retained rows');
assert.equal(prepare({ maxLength: 2, preparedRows: retained })[0], short[0]);
assert.equal(retained.stats().entries, 0); assert.equal(measurements.preparedTokenRowHits, 1); release();
const oldRelease = retained.retain(['same'], short, identity);
const newerRows = [{ input_ids: [8], attention_mask: [1], token_type_ids: null }];
const newRelease = retained.retain(['same'], newerRows, identity);
oldRelease(); assert.equal(retained.stats().entries, 1, 'an older estimate release cannot release a newer row owner');
assert.equal(retained.take('same', identity), newerRows[0]); newRelease();

let duplicateCalls = 0;
const duplicateTokenizer = texts => { duplicateCalls++; assert.deepEqual(texts, ['duplicate']); return { input_ids: [[1n, 2n]], attention_mask: [[true, false]] }; };
const paddedWork = {};
const duplicates = tokenizeBatchWithCache({ tokenizer: duplicateTokenizer, texts: ['duplicate', 'duplicate'], measurements: paddedWork });
assert.deepEqual(duplicates.input_ids, [[1, 2], [1, 2]]); assert.deepEqual(duplicates.attention_mask, [[1, 0], [1, 0]]);
assert.equal(duplicateCalls, 1); assert.equal(paddedWork.tokenizerInputTexts, 1); assert.equal(paddedWork.preparedUsefulTokens, 2);
assert.equal(paddedWork.paddedTokenCells, 4); assert.equal(paddedWork.paddedFieldCells, 8);

for (const output of [
  { input_ids: [[1]] }, { input_ids: [[1], [2], [3]] }, { input_ids: [1, 2] },
  { input_ids: [[1], null] }, { input_ids: [[1], ['2']] }, { input_ids: [[1], [1.5]] },
  { input_ids: [[1], [NaN]] }, { input_ids: [[1], [-1]] }, { input_ids: [[1], [9007199254740992n]] },
  { input_ids: [[1], [2]], attention_mask: [[1]] }, { input_ids: [[1], [2]], attention_mask: [[1], []] },
  { input_ids: [[1], [2]], attention_mask: [[1], [2]] }, { input_ids: [[1], [2]], attention_mask: [[1], ['1']] },
  { input_ids: [[1], [2]], token_type_ids: [[0], []] }, { input_ids: [[1], [2]], token_type_ids: [[0], [0.1]] }
]) {
  const badCache = { enabled: true, maxEntries: 8, cache: new Map() };
  assert.throws(() => prepareTokenRowsWithCache({ tokenizer: () => output, texts: ['first', 'second'],
    wantsTokenTypeIds: true, tokenizationCache: badCache }), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
  assert.equal(badCache.cache.size, 0, 'malformed token batches never populate the cache');
}
assert.deepEqual(tokenizeBatchWithCache({ tokenizer: () => ({ input_ids: new BigInt64Array([1n, 2n]) }), texts: ['single'] }).input_ids, [[1, 2]]);
assert.throws(() => tokenizeBatchWithCache({ tokenizer: Object.assign(() => ({ input_ids: [[1]] }), { pad_token_id: '0' }),
  texts: ['single'] }), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
console.log('Exact tokenizer/preprocessing reuse, bounded owner release, work counters and malformed admission controls authored; execution deferred.');
