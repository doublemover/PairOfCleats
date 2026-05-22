#!/usr/bin/env node
import assert from 'node:assert/strict';

import { getBitmapSize, isRoaringAvailable } from '../../../src/retrieval/bitmap.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createAvailableDenseAnnProvider,
  createInMemorySearchPipeline
} from './helpers/in-memory-search-pipeline-fixture.js';

applyTestEnv();

const baseChunkMeta = () => ([
  { id: 0, tokens: ['alpha'], weight: 1, file: 'src/a.js', ext: '.js', kind: 'Definition' },
  { id: 1, tokens: ['alpha'], weight: 1, file: 'src/b.js', ext: '.js', kind: 'Definition' },
  { id: 2, tokens: ['gamma'], weight: 1, file: 'src/c.js', ext: '.js', kind: 'Definition' },
  { id: 3, tokens: ['alpha'], weight: 1, file: 'src/d.ts', ext: '.ts', kind: 'Definition' }
]);

const baseIndex = () => ({
  chunkMeta: baseChunkMeta(),
  tokenIndex: {
    vocab: ['alpha'],
    postings: [
      [[0, 1], [1, 1], [3, 1]]
    ],
    docLengths: [1, 1, 1, 1],
    totalDocs: 4,
    avgDocLen: 1
  },
  denseVec: {
    vectors: [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.9, 0.9],
      [0.3, 0.3]
    ]
  },
  minhash: { signatures: [] }
});

const createBasePipeline = ({
  provider,
  annCandidateCap = 1,
  filters = { ext: ['js'] },
  filtersActive = true
}) => createInMemorySearchPipeline({
  provider,
  filters,
  filtersActive,
  topN: 3,
  annCandidateCap,
});

const sortedCandidateSet = (candidateSet) => (
  candidateSet
    ? Array.from(candidateSet).sort((a, b) => a - b)
    : null
);

const runFallbackRetryScenario = async (annCandidateCap) => {
  const annCandidateSets = [];
  const provider = createAvailableDenseAnnProvider(async ({ candidateSet }) => {
    annCandidateSets.push(sortedCandidateSet(candidateSet));
    if (candidateSet && candidateSet.has(2)) {
      return [{ idx: 2, sim: 0.95 }];
    }
    return [];
  });
  const pipeline = createBasePipeline({ provider, annCandidateCap });
  const results = await pipeline(baseIndex(), 'code', [0.4, 0.4]);
  return { annCandidateSets, results };
};

const assertFallbackRetryResult = ({ annCandidateSets, results }) => {
  assert.equal(annCandidateSets.length, 2);
  assert.deepEqual(annCandidateSets[0], [0, 1]);
  assert.deepEqual(annCandidateSets[1], [0, 1, 2]);
  assert.ok(results.some((entry) => entry.id === 2 && entry.annSource === ANN_PROVIDER_IDS.DENSE));
};

const cases = [
  {
    name: 'nonvector mode never initializes ANN providers',
    async run() {
      let initCount = 0;
      const searchPipeline = createInMemorySearchPipeline({
        createAnnProviders: () => {
          initCount += 1;
          return new Map([[
            'js',
            { id: 'dense', isAvailable: () => true, query: async () => [] }
          ]]);
        }
      });
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(String(msg));
      try {
        const results = await searchPipeline({
          chunkMeta: [
            { id: 0, tokens: ['alpha'], weight: 1, file: 'a.js', kind: 'Definition' },
            { id: 1, tokens: ['alpha'], weight: 1, file: 'b.js', kind: 'Definition' }
          ],
          minhash: { signatures: [] }
        }, 'code', null);
        assert.equal(initCount, 0);
        assert.equal(warnings.length, 0);
        assert.ok(Array.isArray(results) && results.length > 0);
      } finally {
        console.warn = originalWarn;
      }
    }
  },
  {
    name: 'fallback retries from filtered BM candidates to full allowed set',
    async run() {
      assertFallbackRetryResult(await runFallbackRetryScenario(1));
    }
  },
  {
    name: 'fractional candidate cap still retries after clamp',
    async run() {
      assertFallbackRetryResult(await runFallbackRetryScenario(0.5));
    }
  },
  {
    name: 'bitmap allowlist fallback preserves bitmap candidate representation',
    async run() {
      if (!isRoaringAvailable()) return;
      const providerCandidateKinds = [];
      const providerCandidateSizes = [];
      const hasCandidateId = (candidateSet, id) => {
        if (!candidateSet) return false;
        if (candidateSet instanceof Set) return candidateSet.has(id);
        if (typeof candidateSet.has === 'function') return candidateSet.has(id);
        if (typeof candidateSet.contains === 'function') return candidateSet.contains(id);
        if (typeof candidateSet.includes === 'function') return candidateSet.includes(id);
        return false;
      };
      const provider = createAvailableDenseAnnProvider(async ({ candidateSet }) => {
        providerCandidateKinds.push(candidateSet instanceof Set ? 'set' : 'bitmap');
        providerCandidateSizes.push(getBitmapSize(candidateSet));
        if (hasCandidateId(candidateSet, 2)) {
          return [{ idx: 2, sim: 0.95 }];
        }
        return [];
      });
      const idx = baseIndex();
      idx.filterIndex = buildFilterIndex(idx.chunkMeta);
      idx.filterIndex.bitmap = null;
      const pipeline = createBasePipeline({ provider, annCandidateCap: 100 });
      const results = await pipeline(idx, 'code', [0.4, 0.4]);
      assert.equal(providerCandidateKinds.length, 2);
      assert.equal(providerCandidateKinds[0], 'set');
      assert.equal(providerCandidateKinds[1], 'bitmap');
      assert.deepEqual(providerCandidateSizes, [2, 3]);
      assert.ok(results.some((entry) => entry.id === 2 && entry.annSource === ANN_PROVIDER_IDS.DENSE));
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('ann fallback contract matrix test passed');
