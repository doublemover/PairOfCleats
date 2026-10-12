import assert from 'node:assert/strict';
import { runBatched, assertVectorArrays } from '../../../tools/build/embeddings/embed.js';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { createEmbeddingWorkEstimate } from '../../../tools/build/embeddings/work-estimate.js';

// Interleaved source families: packing reduces padding without changing payloads,
// vector identity, or the number of provider calls.
const texts = Array.from({ length: 32 }, (_, i) => `${i}:` + 'x'.repeat(i % 2 ? 1000 : 10));
const estimates = texts.map((_, i) => i % 2 ? 256 : 4);
const groups = texts.map((_, i) => ({ groupId: `file-${i >> 2}`, chunkId: i, kind: i % 2 ? 'doc' : 'code' }));
const measure = async (grouped) => {
  let padded = 0, calls = 0;
  const out = await runBatched({ texts, tokenEstimates: estimates, groups: grouped ? groups : null,
    batchSize: 8, embed: async (batch) => { calls++; return batch.map((text) => [Number(text.split(':')[0])]); },
    onBatch: (batch) => { padded += batch.paddedTokens; }
  });
  assert.deepEqual(out, texts.map((_, i) => [i]));
  return { padded, calls };
};
const baseline = await measure(false), grouped = await measure(true);
assert.equal(grouped.calls, baseline.calls);
assert.ok(grouped.padded < baseline.padded);
console.log(JSON.stringify({ baseline, grouped }));
let scheduled = 0, resolved = 0, prepared = 0;
const completed = [];
const processor = createFileEmbeddingsProcessor({ embeddingBatchSize: 4, embeddingBatchTokenBudget: 40,
  mode: 'code', runBatched, assertVectorArrays, scheduleCompute: (fn) => fn(),
  globalMicroBatching: true, globalMicroBatchingMaxWaitMs: 1,
  getChunkEmbeddings: async (batch) => batch.map((text) => [text.length]),
  processFileEmbeddings: async (entry) => { completed.push(entry); },
  onEmbeddingScheduled: ({ requested }) => { scheduled += requested; },
  onEmbeddingPrepared: ({ delta }) => { if (!delta) prepared++; },
  onEmbeddingUsage: ({ requested }) => { resolved += requested; }
});
const entry = (id) => ({ normalizedRel: id, items: [{ chunk: { chunkId: 'a' } }, { chunk: { chunkId: 'b' } }],
  codeTexts: ['long long code', 'x'], codeMapping: [1, 0], docTexts: ['doc', ''], docMapping: [0, 1] });
await Promise.all([processor(entry('a.ts')), processor(entry('b.ts'))]);
await processor.drain();
assert.equal(scheduled, 6);
assert.equal(resolved, 6);
assert.equal(prepared, 2);
for (const file of completed) {
  assert.deepEqual(file.codeEmbeds, [[1], [14]]);
  assert.deepEqual(file.docVectorsRaw, [[3], null]);
}
assert.equal(processor.batchingStats().activeProviderCalls, 0);
assert.equal(processor.batchingStats().pending, 0);
assert.equal(processor.batchingStats().peakProviderCalls, 1);
const cacheWork = createEmbeddingWorkEstimate({ entries: [['cached', [{ chunk: { start: 0, end: 200 } }]]] });
const cachedProcessor = createFileEmbeddingsProcessor({ embeddingBatchSize: 8, mode: 'code',
  runBatched, assertVectorArrays, scheduleCompute: (fn) => fn(),
  embeddingTextCache: { get: () => [5], set: () => {}, canCache: () => true },
  getChunkEmbeddings: async () => { throw new Error('cached payload must not reach provider'); },
  processFileEmbeddings: async () => {},
  onEmbeddingPrepared: ({ groupId, tokens, delta }) => {
    if (delta) cacheWork.adjust(groupId, tokens); else cacheWork.prepare(groupId, tokens);
  }
});
await cachedProcessor(entry('cached'));
assert.equal(cacheWork.snapshot().remainingTokens, 0, 'text-cache reuse removes all pending compute cost');
let calls = 0;
await assert.rejects(runBatched({ texts: ['a', 'b', 'c'], batchSize: 1, groups: groups.slice(0, 3),
  embed: async () => { if (++calls === 2) throw new Error('provider stopped'); return [[1]]; }
}), /provider stopped/);
assert.equal(calls, 2, 'stop after failure, do not dispatch later batches');
await assert.rejects(runBatched({ texts: ['a'], batchSize: 1, embed: async () => [] }), /size mismatch/);

let clock = 0;
const work = createEmbeddingWorkEstimate({ entries: [
  ['small', [{ chunk: { start: 0, end: 40 } }]],
  ['large', [{ chunk: { start: 0, end: 4000 } }]]
], now: () => clock });
assert.equal(work.snapshot().remainingTokens, 1010);
assert.equal(work.snapshot().etaSeconds, null);
work.prepare('small', 8);
work.batch({ groupTokens: [['small', 8]], batchTokens: 8, durationMs: 80 });
work.complete('small');
assert.equal(work.snapshot().etaSeconds, 10, 'size of remaining file determines ETA');
work.prepare('large', 200); // source/cache preparation refines remaining work.
work.adjust('large', -100); // formatted estimates and cache/dedup remove owned work.
assert.equal(work.snapshot().etaSeconds, 1);
clock = 121000;
work.batch({ groupTokens: [['large', 10]], batchTokens: 10, durationMs: 20 });
assert.equal(work.snapshot().etaSeconds, 0.18, 'recent cost replaces obsolete history');
work.complete('large');
assert.equal(work.snapshot().remainingTokens, 0);
assert.equal(work.snapshot().etaSeconds, 0);
console.log('grouped embedding work/progress contracts passed');
