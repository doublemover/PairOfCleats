#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  BENCH_METHODOLOGY_POLICY_VERSION,
  createBenchMethodologyPolicy,
  filterTasksToControlSlice,
  selectBenchControlSlice
} from '../../../tools/bench/language/policy.js';

const tasks = [
  { language: 'javascript', tier: 'small', repo: 'org/js-small' },
  { language: 'javascript', tier: 'large', repo: 'org/js-large' },
  { language: 'python', tier: 'small', repo: 'org/py-small' },
  { language: 'python', tier: 'medium', repo: 'org/py-medium' },
  { language: 'rust', tier: 'small', repo: 'org/rust-small' }
];

const controlSlice = selectBenchControlSlice(tasks, { maxTasks: 4 });
assert.equal(controlSlice.tasks.length, 4, 'expected bounded control slice size');
assert.deepEqual(
  controlSlice.taskIds,
  [
    'javascript:small:org/js-small',
    'javascript:large:org/js-large',
    'python:small:org/py-small',
    'python:medium:org/py-medium'
  ],
  'expected deterministic control-slice ordering by language and representative tier'
);

const methodology = createBenchMethodologyPolicy({
  argv: { mode: 'tooling', 'control-slice-max': 4 },
  tasks
});
assert.equal(methodology.policyVersion, BENCH_METHODOLOGY_POLICY_VERSION, 'expected methodology policy version');
assert.equal(methodology.mode, 'tooling', 'expected explicit mode');
assert.equal(methodology.toolingMode, 'included', 'expected tooling mode to be included for tooling runs');
assert.equal(methodology.timeoutPolicyVersion, '1.1.0', 'expected timeout policy version tagging');

const filtered = filterTasksToControlSlice(tasks, methodology);
assert.equal(filtered.length, 4, 'expected filtering to match control slice');

console.log('bench language policy test passed');
