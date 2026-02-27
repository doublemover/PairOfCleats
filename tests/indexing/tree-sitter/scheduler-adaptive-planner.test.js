#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { treeSitterSchedulerPlannerInternals } from '../../../src/index/build/tree-sitter-scheduler/plan.js';

applyTestEnv({ testing: '1' });

const {
  resolveAdaptiveBucketTargetJobs,
  assignPathAwareBuckets,
  summarizeBucketMetrics,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves,
  buildLaneDiagnostics,
  buildContinuousWaveExecutionOrder
} = treeSitterSchedulerPlannerInternals;

const observedRows = new Map([
  ['cpp', { rowsPerSec: 2000 }]
]);
const adaptiveTarget = resolveAdaptiveBucketTargetJobs({
  group: { grammarKey: 'cpp', languages: ['cpp'], jobs: new Array(400).fill({}) },
  schedulerConfig: { adaptiveBucketTargetMs: 1000, heavyGrammarBucketTargetJobs: 512 },
  observedRowsPerSecByGrammar: observedRows
});
assert.ok(adaptiveTarget >= 1000, 'expected adaptive bucket sizing to scale with observed throughput');

const jobs = [];
for (let i = 0; i < 20; i += 1) {
  jobs.push({
    languageId: 'cpp',
    containerPath: i < 14
      ? `src/giant/module/file-${i}.cc`
      : `src/other/file-${i}.cc`,
    virtualPath: `src/file-${i}.cc`
  });
}
const buckets = assignPathAwareBuckets({ jobs, bucketCount: 4 });
const populated = buckets.filter((bucket) => bucket.length > 0);
assert.ok(populated.length >= 3, 'expected path-aware bucketing to spread work across buckets');
const weightedJobs = [];
for (let i = 0; i < 64; i += 1) {
  const isHotPath = i < 40;
  weightedJobs.push({
    languageId: 'php',
    containerPath: isHotPath
      ? `app/monolith/hot-${i}.php`
      : `app/misc/light-${i}.php`,
    virtualPath: `app/file-${i}.php`,
    estimatedParseCost: isHotPath ? 180 + ((i % 7) * 8) : 28 + (i % 5)
  });
}
const weightedBuckets = assignPathAwareBuckets({ jobs: weightedJobs, bucketCount: 6 });
const weightedMetrics = summarizeBucketMetrics(weightedBuckets);
assert.ok(
  weightedMetrics.cost.spreadRatio <= 1.8,
  `expected weighted partitioning spreadRatio <= 1.8, got ${weightedMetrics.cost.spreadRatio}`
);

const highCardinalityGroup = {
  grammarKey: 'native:php',
  languages: ['php'],
  jobs: weightedJobs
};
const sharded = shardGrammarGroup({
  group: highCardinalityGroup,
  schedulerConfig: {
    heavyGrammarBucketTargetJobs: 96,
    heavyGrammarBucketMax: 12,
    adaptiveBucketTargetMs: 900
  },
  observedRowsPerSecByGrammar: new Map()
});
assert.ok(sharded.length > 1, 'expected high-cardinality php grammar to split into multiple buckets');
assert.ok(
  sharded.some((entry) => entry?.laneMetrics?.highCardinality === true),
  'expected non-ruby grammar to be marked high-cardinality when skew/cost is high'
);
const unsplitCostMetrics = summarizeBucketMetrics([weightedJobs]);
const shardedCostMetrics = summarizeBucketMetrics(sharded.map((entry) => entry.jobs || []));
assert.ok(
  shardedCostMetrics.cost.max < unsplitCostMetrics.cost.max,
  'expected sharding to lower tail bucket parse cost versus a single unsplit lane'
);
const waveGroups = sharded.flatMap((bucketGroup) => splitGrammarBucketIntoWaves({
  group: bucketGroup,
  schedulerConfig: {
    adaptiveWaveTargetMs: 700
  },
  observedRowsPerSecByGrammar: new Map()
}));
assert.ok(
  waveGroups.length >= sharded.length,
  'expected wave splitting to preserve or increase partition count'
);
const laneDiagnostics = buildLaneDiagnostics(waveGroups);
assert.ok(
  laneDiagnostics?.byBaseGrammar?.['native:php']?.bucketCount > 1,
  'expected lane diagnostics to report multiple buckets for high-cardinality grammar'
);
assert.ok(
  Number(laneDiagnostics?.byBaseGrammar?.['native:php']?.bucketCost?.imbalanceRatio) >= 1,
  'expected lane diagnostics to include imbalance metrics'
);

const shrinkObserved = new Map([
  ['native:php', {
    rowsPerSec: 1200,
    laneState: { bucketCount: 6, cooldownSteps: 1, lastAction: 'split' }
  }]
]);
const shrinkGroup = {
  grammarKey: 'native:php',
  languages: ['php'],
  jobs: Array.from({ length: 10 }, (_unused, i) => ({
    languageId: 'php',
    containerPath: `app/shrunk/${i}.php`,
    virtualPath: `app/shrunk/${i}.php`,
    estimatedParseCost: 16 + (i % 3)
  }))
};
const shrinkSharded = shardGrammarGroup({
  group: shrinkGroup,
  schedulerConfig: {
    heavyGrammarBucketTargetJobs: 512
  },
  observedRowsPerSecByGrammar: shrinkObserved
});
assert.ok(shrinkSharded.length > 0, 'expected shrink shard plan to produce groups');
assert.equal(
  shrinkSharded[0]?.shard?.bucketCount,
  5,
  'expected anti-oscillation guardrails to limit immediate merge step from 6 -> 5 lanes'
);

const order = buildContinuousWaveExecutionOrder([
  { grammarKey: 'cpp~b01~w01', bucketKey: 'cpp~b01', wave: { waveIndex: 1 } },
  { grammarKey: 'cpp~b01~w02', bucketKey: 'cpp~b01', wave: { waveIndex: 2 } },
  { grammarKey: 'cpp~b02~w01', bucketKey: 'cpp~b02', wave: { waveIndex: 1 } },
  { grammarKey: 'cpp~b02~w02', bucketKey: 'cpp~b02', wave: { waveIndex: 2 } }
]);
assert.deepEqual(
  order,
  ['cpp~b01~w01', 'cpp~b02~w01', 'cpp~b01~w02', 'cpp~b02~w02'],
  'expected continuous wave execution to interleave buckets'
);

console.log('tree-sitter scheduler adaptive planner test passed');
