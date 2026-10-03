#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

applyTestEnv();

const stageTracker = createRetrievalStageTracker({ enabled: true });
const pipeline = createSearchPipelineFixture({
  sqliteFtsWeights: null,
  postingsConfig: {
    enablePhraseNgrams: false,
    enableChargrams: false,
    chargramMinN: 3,
    chargramMaxN: 3
  },
  explain: false,
  topN: 3,
  maxCandidates: null,
  annEnabled: true,
  annBackend: 'js',
  rankSqliteFts: () => ({ hits: [], type: 'fts' }),
  graphRankingConfig: { enabled: false },
  stageTracker
});

const idx = createAlphaSearchIndex({
  chunks: [
    {
      id: 0,
      file: 'src/a.js',
      start: 0,
      end: 10,
      tokens: ['alpha'],
      weight: 1
    }
  ],
  repoMap: null,
});

await pipeline(idx, 'code', [0, 0]);

const stages = stageTracker.stages.map((entry) => entry.stage);
assert.ok(stages.includes('filter'), 'expected filter stage');
assert.ok(stages.includes('candidates'), 'expected candidates stage');
assert.ok(stages.includes('ann'), 'expected ann stage');
assert.ok(stages.includes('fusion'), 'expected fusion stage');
assert.ok(stages.includes('rank'), 'expected rank stage');

console.log('retrieval stage checkpoints test passed');
