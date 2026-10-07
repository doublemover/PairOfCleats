#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { resolveDenseVector } from '../../../src/retrieval/cli/index-loader.js';
import { normalizeEmbeddingDims } from '../../../src/retrieval/ann/dims.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createDenseAnnProvider } from '../../../src/retrieval/ann/providers/dense.js';
import { resolveIntentVectorMode } from '../../../src/retrieval/query-intent.js';
import { rankHnswIndex } from '../../../src/shared/hnsw.js';
import { distanceToSimilarity } from '../../../src/shared/ann-similarity.js';
import { canRunAnnQuery, isCandidateSetEmpty, isEmbeddingReady } from '../../../src/retrieval/ann/utils.js';
import { buildAnnPipelineFixture } from '../pipeline/helpers/ann-scenarios.js';

const cases = [
  {
    name: 'embedding readiness and candidate-set emptiness guards stay stable',
    run() {
      assert.equal(isEmbeddingReady([0.1]), true);
      assert.equal(isEmbeddingReady(new Float32Array([0.1, 0.2])), true);
      assert.equal(isEmbeddingReady([]), false);
      assert.equal(isEmbeddingReady(null), false);

      assert.equal(isCandidateSetEmpty(null), false);
      assert.equal(isCandidateSetEmpty(new Set()), true);
      assert.equal(isCandidateSetEmpty(new Set([1])), false);
      assert.equal(isCandidateSetEmpty({ size: () => 0 }), true);
      assert.equal(isCandidateSetEmpty({ size: () => 2 }), false);
      assert.equal(isCandidateSetEmpty({ getSize: () => 0 }), true);
      assert.equal(isCandidateSetEmpty([]), true);
      assert.equal(isCandidateSetEmpty([1]), false);

      const embedding = [0.1, 0.2];
      assert.equal(canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: true, enabled: true }), true);
      assert.equal(canRunAnnQuery({ signal: { aborted: true }, embedding, candidateSet: null, backendReady: true, enabled: true }), false);
      assert.equal(canRunAnnQuery({ signal: null, embedding, candidateSet: new Set(), backendReady: true, enabled: true }), false);
      assert.equal(canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: false, enabled: true }), false);
      assert.equal(canRunAnnQuery({ signal: null, embedding, candidateSet: null, backendReady: true, enabled: false }), false);
    }
  },
  {
    name: 'dense vector mode and dimension normalization choose the right representation',
    run() {
      const idx = {
        denseVec: { label: 'merged' },
        denseVecDoc: { label: 'doc' },
        denseVecCode: { label: 'code' }
      };
      assert.equal(resolveDenseVector(idx, 'code', 'code')?.label, 'code');
      assert.equal(resolveDenseVector(idx, 'prose', 'doc')?.label, 'doc');
      assert.equal(resolveDenseVector(idx, 'code', 'merged')?.label, 'merged');
      assert.equal(resolveDenseVector(idx, 'code', 'auto')?.label, 'code');
      assert.equal(resolveDenseVector(idx, 'prose', 'auto')?.label, 'doc');

      const fallbackIdx = { denseVec: { label: 'merged' } };
      assert.equal(resolveDenseVector(fallbackIdx, 'code', 'code')?.label, 'merged');
      assert.equal(resolveDenseVector(fallbackIdx, 'prose', 'doc')?.label, 'merged');

      assert.equal(resolveIntentVectorMode('auto', { vectorMode: 'doc' }), 'doc');
      assert.equal(resolveIntentVectorMode('auto', { vectorMode: null }), 'auto');
      assert.equal(resolveIntentVectorMode('code', { vectorMode: 'doc' }), 'code');

      const clipped = normalizeEmbeddingDims([1, 2, 3, 4], 2);
      assert.equal(clipped.adjusted, true);
      assert.equal(clipped.queryDims, 4);
      assert.equal(clipped.expectedDims, 2);
      assert.deepEqual(clipped.embedding, [1, 2]);

      const padded = normalizeEmbeddingDims(new Float32Array([3, 4]), 4);
      assert.equal(padded.adjusted, true);
      assert.equal(padded.queryDims, 2);
      assert.equal(padded.expectedDims, 4);
      assert.deepEqual(padded.embedding, [3, 4, 0, 0]);

      const unchanged = normalizeEmbeddingDims([7, 8, 9], 3);
      assert.equal(unchanged.adjusted, false);
      assert.deepEqual(unchanged.embedding, [7, 8, 9]);
    }
  },
  {
    name: 'similarity conversion and HNSW ranking preserve score ordering by metric',
    run() {
      assert.equal(distanceToSimilarity(0.25, 'cosine'), 0.75);
      assert.equal(distanceToSimilarity(4, 'l2'), -4);
      assert.equal(distanceToSimilarity(1.5, 'ip'), -1.5);
      assert.equal(distanceToSimilarity(Number.NaN, 'l2'), null);

      const fakeIndex = {
        getCurrentCount: () => 2,
        searchKnn: () => ({
          neighbors: [7, 3],
          distances: [0.2, 0.8]
        })
      };

      const cosineHits = rankHnswIndex({ index: fakeIndex, space: 'cosine' }, [0.1], 2, null);
      assert.deepEqual(cosineHits, [{ idx: 7, sim: 0.8 }, { idx: 3, sim: 0.19999999999999996 }]);

      const ipHits = rankHnswIndex({ index: fakeIndex, space: 'ip' }, [0.1], 2, null);
      assert.deepEqual(ipHits, [{ idx: 7, sim: -0.2 }, { idx: 3, sim: -0.8 }]);
    }
  },
  {
    name: 'dense ANN providers lazy-load vectors only once across repeated pipeline runs',
    async run() {
      const { context, idx } = buildAnnPipelineFixture({
        createAnnProviders: () => new Map([
          [ANN_PROVIDER_IDS.DENSE, createDenseAnnProvider()]
        ])
      });
      context.annBackend = 'dense';
      idx.denseVec = { dims: 2, minVal: -1, maxVal: 1, levels: 256, scale: 1, vectors: null };

      let loadCalls = 0;
      idx.loadDenseVectors = async () => {
        loadCalls += 1;
        idx.denseVec = {
          dims: 2,
          minVal: -1,
          maxVal: 1,
          levels: 256,
          scale: 1,
          vectors: [
            [0.1, 0.2],
            [0.2, 0.1]
          ]
        };
        return idx.denseVec;
      };

      const pipeline = createSearchPipeline(context);
      const run1 = await pipeline(idx, 'code', [0.1, 0.2]);
      const run2 = await pipeline(idx, 'code', [0.1, 0.2]);

      assert.ok(run1.length > 0);
      assert.ok(run2.length > 0);
      assert.equal(loadCalls, 1);
      assert.ok(run1.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE));
      assert.ok(run2.some((entry) => entry.annSource === ANN_PROVIDER_IDS.DENSE));
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('ann utility contract matrix test passed');
