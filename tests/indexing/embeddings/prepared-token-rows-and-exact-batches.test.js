import assert from 'node:assert/strict';
import { createPreparedTokenRows, prepareTokenRowsWithCache, tokenizeBatchWithCache } from '../../../src/shared/onnx-embeddings/tokenization.js';
import { planEmbeddingBatches } from '../../../tools/build/embeddings/batch-plan.js';
import { runBatched } from '../../../tools/build/embeddings/embed.js';
let encodedItems = 0;
const tokenizer = texts => {
  encodedItems += texts.length;
  return { input_ids: texts.map(text => Array(Number(text.split(':')[0])).fill(7)),
    attention_mask: texts.map(text => Array(Number(text.split(':')[0])).fill(1)),
    token_type_ids: texts.map(text => Array(Number(text.split(':')[0])).fill(2)) };
};
const tokenizationCache = { enabled: true, maxEntries: 256, cache: new Map() };
const heterogeneous = Array.from({ length: 64 }, (_, i) => `${i === 63 ? 512 : 1}:${i}`);
const raw = prepareTokenRowsWithCache({ tokenizer, texts: heterogeneous, wantsTokenTypeIds: true });
assert.equal(raw.reduce((sum, row) => sum + row.input_ids.length, 0), 575);
assert.equal(raw.reduce((sum, row) => sum + row.attention_mask.reduce((a, b) => a + b, 0), 0), 575);
assert.equal(raw[0].token_type_ids.length, 1, 'count preparation never pads');
const texts = Array.from({ length: 512 }, (_, i) => `1:${i}`);
encodedItems = 0;
const rows = prepareTokenRowsWithCache({ tokenizer, texts, wantsTokenTypeIds: true, tokenizationCache });
const preparedRows = createPreparedTokenRows();
const release = preparedRows.retain(texts, rows, true);
for (let i = 0; i < texts.length; i += 64) {
  const encoding = tokenizeBatchWithCache({ tokenizer, texts: texts.slice(i, i + 64), wantsTokenTypeIds: true,
    tokenizationCache, preparedRows });
  assert.equal(encoding.input_ids.length, 64);
  assert.deepEqual(encoding.token_type_ids[0], [2]);
}
assert.equal(encodedItems, 512, 'admitted rows larger than the LRU are not tokenized twice');
release(); assert.equal(preparedRows.stats().entries, 0);
const small = createPreparedTokenRows({ maxEntries: 2, maxBytes: 1000 });
const releaseSmall = small.retain(texts, rows, true);
assert.ok(small.stats().entries <= 2 && small.stats().bytes <= 1000);
releaseSmall(); assert.equal(small.stats().bytes, 0);
const estimates = [129, 255, 129, 255, 129, 255, 129, 255];
const groups = estimates.map((_, i) => ({ groupId: String(i) }));
const plan = planEmbeddingBatches({ estimates, maxItems: 2, tokenBudget: 512, groups });
assert.equal(plan.batches.length, 4); assert.equal(plan.paddedTokens, 1536);
assert.equal(planEmbeddingBatches({ estimates: [5,5,5], maxItems: 2, tokenBudget: 10 }).strategy, 'source-order');
const restored = await runBatched({ texts: estimates.map(String), batchSize: 2, maxBatchTokens: 512,
  tokenEstimates: estimates, groups, embed: async batch => batch.map(Number).map(value => [value, 1]) });
assert.deepEqual(restored.map(row => row[0]), estimates);
assert.deepEqual(plan.batches.flat().slice().sort((a,b) => a-b), estimates.map((_, i) => i));
console.log('prepared token rows and exact batches passed');