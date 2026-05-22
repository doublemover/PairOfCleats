#!/usr/bin/env node
import assert from 'node:assert/strict';

import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

const withMockedNow = async (action) => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    return await action({
      advance: (ms) => {
        now += ms;
        return now;
      }
    });
  } finally {
    Date.now = originalNow;
  }
};

const cases = [
  {
    name: 'empty ANN success resets retry cadence after transient failures',
    async run() {
      let queryCalls = 0;
      const provider = {
        id: ANN_PROVIDER_IDS.DENSE,
        isAvailable: () => true,
        preflight: async () => true,
        query: async () => {
          queryCalls += 1;
          if (queryCalls === 1) throw new Error('transient ann error #1');
          if (queryCalls === 2) return [];
          if (queryCalls === 3) throw new Error('transient ann error #2');
          return [{ idx: 0, sim: 0.95 }];
        }
      };
      const { context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
      });
      const pipeline = createSearchPipeline(context);
      await withMockedNow(async (clock) => {
        const run1 = await pipeline(idx, 'code', [0.1, 0.2]);
        const run2 = await pipeline(idx, 'code', [0.1, 0.2]);
        clock.advance(1100);
        const run3 = await pipeline(idx, 'code', [0.1, 0.2]);
        const run4 = await pipeline(idx, 'code', [0.1, 0.2]);
        clock.advance(1100);
        const run5 = await pipeline(idx, 'code', [0.1, 0.2]);
        assert.ok(Array.isArray(run1) && run1.length > 0);
        assert.ok(Array.isArray(run2) && run2.length > 0);
        assert.ok(Array.isArray(run3) && run3.length > 0);
        assert.ok(Array.isArray(run4) && run4.length > 0);
        assert.ok(Array.isArray(run5) && run5.length > 0);
        assert.equal(queryCalls, 4);
        assert.ok(run5.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE));
      });
    }
  },
  {
    name: 'provider retry state resets after cooldown and successful preflight',
    async run() {
      let preflightCalls = 0;
      let queryCalls = 0;
      const provider = {
        id: ANN_PROVIDER_IDS.DENSE,
        isAvailable: () => true,
        preflight: async () => {
          preflightCalls += 1;
          return preflightCalls > 1;
        },
        query: async () => {
          queryCalls += 1;
          return [{ idx: 0, sim: 0.99 }];
        }
      };
      const { stageTracker, context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]])
      });
      const pipeline = createSearchPipeline(context);
      await withMockedNow(async (clock) => {
        const run1 = await pipeline(idx, 'code', [0.1, 0.2]);
        const run2 = await pipeline(idx, 'code', [0.1, 0.2]);
        clock.advance(1500);
        const run3 = await pipeline(idx, 'code', [0.1, 0.2]);
        assert.ok(Array.isArray(run1) && run1.length > 0);
        assert.ok(Array.isArray(run2) && run2.length > 0);
        assert.ok(Array.isArray(run3) && run3.length > 0);
        assert.equal(preflightCalls, 2);
        assert.equal(queryCalls, 1);
        assert.ok(run3.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE));
        assert.ok(run3.some((entry) => entry.annType === 'vector'));
        const annStages = stageTracker.stages.filter((entry) => entry.stage === 'ann');
        assert.ok(annStages.length >= 3);
      });
    }
  },
  {
    name: 'unnamed provider state stays isolated across fallback providers',
    async run() {
      let primaryPreflightCalls = 0;
      let fallbackPreflightCalls = 0;
      let fallbackQueryCalls = 0;
      const primaryProvider = {
        isAvailable: () => true,
        preflight: async () => {
          primaryPreflightCalls += 1;
          return false;
        },
        query: async () => []
      };
      const fallbackProvider = {
        isAvailable: () => true,
        preflight: async () => {
          fallbackPreflightCalls += 1;
          return true;
        },
        query: async () => {
          fallbackQueryCalls += 1;
          return [{ idx: 0, sim: 0.97 }];
        }
      };
      const { context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([
          [ANN_PROVIDER_IDS.HNSW, primaryProvider],
          [ANN_PROVIDER_IDS.DENSE, fallbackProvider]
        ])
      });
      context.annBackend = 'auto';
      const pipeline = createSearchPipeline(context);
      const results = await pipeline(idx, 'code', [0.1, 0.2]);
      assert.ok(Array.isArray(results) && results.length > 0);
      assert.equal(primaryPreflightCalls, 1);
      assert.equal(fallbackPreflightCalls, 1);
      assert.equal(fallbackQueryCalls, 1);
      assert.ok(results.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE));
    }
  },
  {
    name: 'adaptive ordering prefers healthy fallback after degraded primary',
    async run() {
      let primaryCalls = 0;
      let fallbackCalls = 0;
      const primaryProvider = {
        id: ANN_PROVIDER_IDS.LANCEDB,
        isAvailable: () => true,
        preflight: async () => true,
        query: async () => {
          primaryCalls += 1;
          if (primaryCalls === 1) throw new Error('transient provider failure');
          return [{ idx: 0, sim: 0.95 }];
        }
      };
      const fallbackProvider = {
        id: ANN_PROVIDER_IDS.SQLITE_VECTOR,
        isAvailable: () => true,
        preflight: async () => true,
        query: async () => {
          fallbackCalls += 1;
          return [{ idx: 1, sim: 0.94 }];
        }
      };
      const { context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([
          [ANN_PROVIDER_IDS.LANCEDB, primaryProvider],
          [ANN_PROVIDER_IDS.SQLITE_VECTOR, fallbackProvider]
        ])
      });
      idx.state = { profile: { id: INDEX_PROFILE_VECTOR_ONLY } };
      context.annBackend = 'auto';
      context.annAdaptiveProviders = true;
      const pipeline = createSearchPipeline(context);
      await withMockedNow(async (clock) => {
        const run1 = await pipeline(idx, 'code', [0.1, 0.2]);
        clock.advance(1100);
        const run2 = await pipeline(idx, 'code', [0.1, 0.2]);
        assert.ok(Array.isArray(run1) && run1.length > 0);
        assert.ok(Array.isArray(run2) && run2.length > 0);
        assert.equal(primaryCalls, 1);
        assert.equal(fallbackCalls, 2);
        assert.ok(run2.some((entry) => entry.annSource === ANN_PROVIDER_IDS.SQLITE_VECTOR));
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('provider runtime contract matrix test passed');
