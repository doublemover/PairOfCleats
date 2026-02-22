#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

const buildTokenIndex = (token, docCount) => ({
  vocab: [token],
  postings: [Array.from({ length: docCount }, (_, idx) => [idx, 1])],
  docLengths: Array.from({ length: docCount }, () => 1),
  totalDocs: docCount,
  avgDocLen: 1
});

{
  let providerCalls = 0;
  const { stageTracker, context, idx } = buildAnnPipelineFixture({
    createAnnProviders: () => new Map([
      [
        ANN_PROVIDER_IDS.DENSE,
        {
          id: ANN_PROVIDER_IDS.DENSE,
          isAvailable: () => true,
          query: async () => {
            providerCalls += 1;
            return [{ idx: 0, sim: 0.9 }];
          }
        }
      ]
    ])
  });
  context.annBackend = 'auto';
  context.annAdaptiveProviders = true;
  context.queryTokens = ['alpha'];
  idx.chunkMeta = Array.from({ length: 24 }, (_, id) => ({
    id,
    file: `src/file-${id}.js`,
    tokens: ['alpha'],
    weight: 1
  }));
  idx.tokenIndex = buildTokenIndex('alpha', idx.chunkMeta.length);
  idx.denseVec = {
    vectors: Array.from({ length: idx.chunkMeta.length }, () => [0.1, 0.2]),
    dims: 2
  };
  const pipeline = createSearchPipeline(context);
  const results = await pipeline(idx, 'code', [0.1, 0.2]);
  assert.ok(results.length > 0, 'expected sparse results to remain available under ANN bypass');
  assert.equal(providerCalls, 0, 'expected ANN provider query to be bypassed on very small indexes');
  const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
  assert.ok(annStage, 'expected ann stage to be recorded');
  assert.equal(annStage.route, 'sparse', 'expected sparse routing decision under adaptive bypass');
  assert.equal(annStage.bypassedToSparse, true, 'expected bypass marker in ann stage metrics');
}

{
  const providerOrder = [];
  let hnswBudget = null;
  const { stageTracker, context, idx } = buildAnnPipelineFixture({
    createAnnProviders: () => new Map([
      [
        ANN_PROVIDER_IDS.LANCEDB,
        {
          id: ANN_PROVIDER_IDS.LANCEDB,
          isAvailable: () => true,
          query: async ({ budget }) => {
            providerOrder.push(ANN_PROVIDER_IDS.LANCEDB);
            hnswBudget = budget;
            return [];
          }
        }
      ],
      [
        ANN_PROVIDER_IDS.HNSW,
        {
          id: ANN_PROVIDER_IDS.HNSW,
          isAvailable: () => true,
          query: async ({ budget }) => {
            providerOrder.push(ANN_PROVIDER_IDS.HNSW);
            hnswBudget = budget;
            return [{ idx: 5, sim: 0.95 }];
          }
        }
      ],
      [
        ANN_PROVIDER_IDS.DENSE,
        {
          id: ANN_PROVIDER_IDS.DENSE,
          isAvailable: () => true,
          query: async () => {
            providerOrder.push(ANN_PROVIDER_IDS.DENSE);
            return [];
          }
        }
      ]
    ])
  });
  context.annBackend = 'auto';
  context.annAdaptiveProviders = true;
  context.topN = 80;
  context.queryTokens = ['::$$##'];
  idx.chunkMeta = Array.from({ length: 240 }, (_, id) => ({
    id,
    file: `src/symbol-${id}.js`,
    tokens: ['::$$##'],
    weight: 1
  }));
  idx.tokenIndex = buildTokenIndex('::$$##', idx.chunkMeta.length);
  idx.denseVec = {
    vectors: Array.from({ length: idx.chunkMeta.length }, () => [0.2, 0.1]),
    dims: 2
  };
  const pipeline = createSearchPipeline(context);
  const results = await pipeline(idx, 'code', [0.2, 0.1]);
  assert.ok(results.length > 0, 'expected ANN-ranked results');
  assert.equal(providerOrder[0], ANN_PROVIDER_IDS.HNSW, 'expected hnsw to be routed first for symbol-heavy query');
  assert.ok(hnswBudget?.hnswEfSearch >= 24, 'expected adaptive hnsw efSearch budget');
  const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
  assert.ok(annStage, 'expected ann stage');
  assert.equal(annStage.route, 'vector', 'expected vector route for large candidate set');
  assert.equal(annStage.orderReason, 'symbolHeavyQuery', 'expected symbol-heavy backend ordering reason');
}

console.log('ann adaptive routing test passed');
