import assert from 'node:assert/strict';
import { createAbortError } from '../../../src/shared/abort.js';
import { runBatched, assertVectorArrays } from '../../../tools/build/embeddings/embed.js';
import { createFileEmbeddingsProcessor } from '../../../tools/build/embeddings/pipeline.js';
import { createEmbeddingWorkEstimate } from '../../../tools/build/embeddings/work-estimate.js';
import { createEmbeddingInFlightCoalescer } from '../../../tools/build/embeddings/runner.js';

// Bind the production processor observers to the actual remaining-work ledger.
// A failed or cancelled file must retain its unfinished cost, even after one
// successful batch, while all admission and provider reservations are released.
for (const globalMicroBatching of [false, true]) {
  for (const failure of ['provider', 'cancelled']) {
    for (const successes of [0, 1]) {
      const texts = ['a', 'bbbbbbbb', 'cccccccccccccccc'];
      const id = `${globalMicroBatching}-${failure}-${successes}.ts`;
      const items = texts.map((text, index) => ({ chunk: { chunkId: `${index}`, text } }));
      const work = createEmbeddingWorkEstimate({ entries: [[id, items]], now: () => 100 });
      const error = failure === 'cancelled' ? createAbortError() : new Error('provider stopped');
      let calls = 0, scheduled = 0, completed = 0, successfulTokens = 0;
      const coalescer = createEmbeddingInFlightCoalescer();
      const textCache = new Map();
      const processor = createFileEmbeddingsProcessor({
        embeddingBatchSize: 1, mode: 'code', globalMicroBatching,
        globalMicroBatchingMaxWaitMs: 0, runBatched, assertVectorArrays,
        scheduleCompute: async (fn) => {
          if (failure === 'cancelled' && calls >= successes) throw error;
          return fn();
        },
        getChunkEmbeddings: async (batch) => {
          if (failure === 'provider' && calls >= successes) throw error;
          calls++;
          return batch.map((text) => [text.length]);
        },
        processFileEmbeddings: async () => { completed++; },
        embeddingTextCache: textCache,
        embeddingInFlightCoalescer: coalescer,
        onEmbeddingScheduled: ({ requested }) => { scheduled += requested; },
        onEmbeddingPrepared: ({ groupId, tokens, delta }) => {
          if (delta) work.adjust(groupId, tokens); else work.prepare(groupId, tokens);
        },
        onEmbeddingBatch: (batch) => { successfulTokens += batch.batchTokens; work.batch(batch); }
      });
      const processEntry = async () => {
        await processor({ normalizedRel: id, items, codeTexts: texts,
          codeMapping: [0, 1, 2], docTexts: [], docMapping: [] });
        work.complete(id);
      };
      await assert.rejects(processEntry(), (actual) => actual === error);
      await processor.drain();
      assert.equal(coalescer.stats().size, 0, 'owner-only failed claims release without orphaned rejected promises');
      assert.equal(scheduled, 3);
      assert.equal(completed, 0, 'failed file cannot reach publication');
      assert.equal(calls, successes);
      const estimate = work.snapshot();
      assert.equal(estimate.remainingGroups, 1, 'failed file is not marked complete');
      assert.equal(estimate.remainingTokens, 7 - successfulTokens);
      assert.equal(estimate.samples, successes, 'failed batch adds no throughput sample');
      if (!successes) assert.equal(estimate.etaSeconds, null);
      else assert.ok(estimate.etaSeconds > 0);
      const stats = processor.batchingStats();
      for (const key of ['activeProviderCalls', 'pending', 'pendingBytes', 'pendingRequests',
        'pendingTexts', 'pendingTokens', 'flushActive']) assert.equal(stats[key], 0, key);
    }
  }
}
console.log('grouped failure/cancellation work ledger and reservation cleanup passed');
