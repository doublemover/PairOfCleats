#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { treeSitterSchedulerPlannerInternals } from '../../../src/index/build/tree-sitter-scheduler/plan.js';

applyTestEnv({ testing: '1' });

const {
  resolveAdaptiveBucketTargetJobs,
  assignPathAwareBuckets,
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
