#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { createCandidatePool } from '../../../src/retrieval/pipeline/candidate-pool.js';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

applyTestEnv();

const candidatePool = createCandidatePool({ maxSets: 2, maxEntries: 100 });
const scoreBufferPool = createScoreBufferPool({ maxBuffers: 2, maxEntries: 100 });

const pipeline = createSearchPipelineFixture({
  sqliteFtsWeights: null,
  postingsConfig: {
    enablePhraseNgrams: false,
    enableChargrams: false,
    phraseMinN: 2,
    phraseMaxN: 3,
    chargramMinN: 3,
    chargramMaxN: 3
  },
  explain: false,
  topN: 2,
  maxCandidates: null,
  annBackend: 'js',
  rankSqliteFts: () => ({ hits: [], type: 'fts' }),
  graphRankingConfig: { enabled: false },
  candidatePool,
  scoreBufferPool
});

const idx = createAlphaSearchIndex({
  chunks: [
    { id: 0, file: 'src/a.js', tokens: ['alpha'], weight: 1 },
    { id: 1, file: 'src/b.js', tokens: ['alpha', 'beta'], weight: 1 }
  ],
  tokenIndex: {
    vocab: ['alpha', 'beta'],
    postings: [
      [[0, 1], [1, 1]],
      [[1, 1]]
    ],
    docLengths: [1, 2],
    totalDocs: 2,
    avgDocLen: 1.5
  }
});

const cases = [
  {
    name: 'pipeline reuse avoids new candidate and score buffer allocations',
    async run() {
      await pipeline(idx, 'code', null);
      const allocationsAfterFirst = {
        candidate: candidatePool.stats.allocations,
        score: scoreBufferPool.stats.allocations
      };

      await pipeline(idx, 'code', null);

      assert.ok(candidatePool.stats.reuses > 0, 'expected candidate pool reuse');
      assert.ok(scoreBufferPool.stats.reuses > 0, 'expected score buffer reuse');
      assert.equal(candidatePool.stats.allocations, allocationsAfterFirst.candidate, 'no extra candidate allocations');
      assert.equal(scoreBufferPool.stats.allocations, allocationsAfterFirst.score, 'no extra score allocations');
    }
  },
  {
    name: 'pool release drops oversized objects and clears reused state',
    async run() {
      const tinyCandidatePool = createCandidatePool({ maxSets: 1, maxEntries: 2 });
      const oversized = tinyCandidatePool.acquire();
      oversized.add(1);
      oversized.add(2);
      oversized.add(3);
      tinyCandidatePool.release(oversized);
      assert.ok(tinyCandidatePool.stats.drops > 0);

      const reused = tinyCandidatePool.acquire();
      assert.equal(reused.size, 0);
      tinyCandidatePool.release(reused);

      const tinyScorePool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 2 });
      const buffer = tinyScorePool.acquire({
        fields: ['idx', 'score'],
        numericFields: ['idx', 'score'],
        capacity: 5
      });
      buffer.push({ idx: 1, score: 0.1 });
      tinyScorePool.release(buffer);
      assert.ok(tinyScorePool.stats.drops > 0);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('candidates buffer reuse test passed');
