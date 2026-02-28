#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  formatResolverPipelineStageSummary,
  resolveResolverPipelineStageHighlights
} from '../../../src/index/build/import-resolution.js';

const stages = {
  fake_stage: { attempts: 100, hits: 100, misses: 0, elapsedMs: 100, budgetExhausted: 100, degraded: 100 },
  normalize: { attempts: 4, hits: 4, misses: 0, elapsedMs: 3.25, budgetExhausted: 0, degraded: 0 },
  language_resolver: { attempts: 2, hits: 1, misses: 1, elapsedMs: 2.5, budgetExhausted: 0, degraded: 1 },
  filesystem_probe: { attempts: 1, hits: 0, misses: 1, elapsedMs: 1.5, budgetExhausted: 2, degraded: 1 },
  classify: { attempts: 1, hits: 1, misses: 0, elapsedMs: 0.5, budgetExhausted: 0, degraded: 0 }
};

assert.equal(
  formatResolverPipelineStageSummary(stages),
  [
    'classify=a1/h1/m0/b0/d0/t0.500ms',
    'filesystem_probe=a1/h0/m1/b2/d1/t1.500ms',
    'language_resolver=a2/h1/m1/b0/d1/t2.500ms',
    'normalize=a4/h4/m0/b0/d0/t3.250ms'
  ].join(', '),
  'expected stable resolver pipeline summary formatting'
);

assert.deepEqual(
  resolveResolverPipelineStageHighlights(stages),
  {
    topByElapsed: { stage: 'normalize', elapsedMs: 3.25 },
    topByBudgetExhausted: { stage: 'filesystem_probe', budgetExhausted: 2 },
    topByDegraded: { stage: 'filesystem_probe', degraded: 1 }
  },
  'expected resolver pipeline highlights to reflect elapsed/budget/degraded leaders'
);

assert.equal(
  formatResolverPipelineStageSummary({}),
  'none',
  'expected empty summary for empty stage pipeline map'
);
assert.deepEqual(
  resolveResolverPipelineStageHighlights({}),
  {
    topByElapsed: null,
    topByBudgetExhausted: null,
    topByDegraded: null
  },
  'expected empty highlights for empty stage pipeline map'
);

console.log('import resolution stage pipeline metrics test passed');
