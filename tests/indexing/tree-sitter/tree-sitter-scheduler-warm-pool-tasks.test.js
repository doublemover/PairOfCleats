#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { treeSitterSchedulerRunnerInternals } from '../../../src/index/build/tree-sitter-scheduler/runner.js';

applyTestEnv({ testing: '1' });

const {
  buildWarmPoolTasks,
  resolveExecutionOrder,
  resolveSchedulerTaskTimeoutMs
} = treeSitterSchedulerRunnerInternals;

const executionOrder = [
  'cpp~b01~w01',
  'cpp~b02~w01',
  'cpp~b01~w02',
  'cpp~b02~w02',
  'java~b01~w01'
];
const groupMetaByGrammarKey = {
  'cpp~b01~w01': { baseGrammarKey: 'cpp' },
  'cpp~b02~w01': { baseGrammarKey: 'cpp' },
  'cpp~b01~w02': { baseGrammarKey: 'cpp' },
  'cpp~b02~w02': { baseGrammarKey: 'cpp' },
  'java~b01~w01': { baseGrammarKey: 'java' }
};

const tasks = buildWarmPoolTasks({
  executionOrder,
  groupMetaByGrammarKey,
  schedulerConfig: { warmPoolPerGrammar: 2 },
  execConcurrency: 8
});

const cppTasks = tasks.filter((entry) => entry.baseGrammarKey === 'cpp');
assert.equal(cppTasks.length, 2, 'expected cpp warm pool to split into two lanes');
assert.ok(
  cppTasks.every((entry) => Array.isArray(entry.grammarKeys) && entry.grammarKeys.length >= 2),
  'expected each cpp lane to receive wave keys'
);
const javaTasks = tasks.filter((entry) => entry.baseGrammarKey === 'java');
assert.equal(javaTasks.length, 1, 'expected single lane for grammar with single key');

const largeExecutionOrder = Array.from({ length: 64 }, (_unused, index) => `php~b${String(index + 1).padStart(2, '0')}~w01`);
const largeGroupMeta = Object.fromEntries(
  largeExecutionOrder.map((grammarKey) => [grammarKey, { baseGrammarKey: 'php' }])
);
const largeTasks = buildWarmPoolTasks({
  executionOrder: largeExecutionOrder,
  groupMetaByGrammarKey: largeGroupMeta,
  schedulerConfig: {},
  execConcurrency: 16
});
const phpLargeTasks = largeTasks.filter((entry) => entry.baseGrammarKey === 'php');
assert.equal(
  phpLargeTasks.length,
  8,
  'expected large mono-language waves to split into higher lane count under available concurrency'
);
const laneSizes = phpLargeTasks.map((entry) => entry.grammarKeys.length).sort((a, b) => a - b);
assert.ok(laneSizes[0] >= 8 && laneSizes[laneSizes.length - 1] <= 8, 'expected balanced lane partitioning for large wave sets');

const smallExecutionOrder = Array.from({ length: 7 }, (_unused, index) => `yaml~b${String(index + 1).padStart(2, '0')}~w01`);
const smallGroupMeta = Object.fromEntries(
  smallExecutionOrder.map((grammarKey) => [grammarKey, { baseGrammarKey: 'yaml' }])
);
const smallTasks = buildWarmPoolTasks({
  executionOrder: smallExecutionOrder,
  groupMetaByGrammarKey: smallGroupMeta,
  schedulerConfig: {},
  execConcurrency: 16
});
const yamlSmallTasks = smallTasks.filter((entry) => entry.baseGrammarKey === 'yaml');
assert.equal(
  yamlSmallTasks.length,
  1,
  'expected small grammar wave sets to avoid default lane splitting'
);

const timeoutByWorkload = resolveSchedulerTaskTimeoutMs({
  schedulerConfig: {},
  task: { grammarKeys: ['php~b01~w01', 'php~b02~w01', 'php~b03~w01'] },
  groupByGrammarKey: new Map([
    ['php~b01~w01', { jobs: 200 }],
    ['php~b02~w01', { jobs: 150 }],
    ['php~b03~w01', { jobs: 100 }]
  ])
});
assert.ok(
  Number.isFinite(timeoutByWorkload) && timeoutByWorkload > 0,
  'expected scheduler task timeout resolver to return a positive timeout'
);
const timeoutExplicit = resolveSchedulerTaskTimeoutMs({
  schedulerConfig: { subprocessTimeoutMs: 45000 },
  task: { grammarKeys: ['php~b01~w01'] },
  groupByGrammarKey: new Map([['php~b01~w01', { jobs: 1 }]])
});
assert.equal(timeoutExplicit, 45000, 'expected explicit scheduler timeout override');

assert.deepEqual(
  resolveExecutionOrder({ executionOrder: ['native:lua', 'native:yaml'] }),
  ['native:lua', 'native:yaml'],
  'expected executionOrder to be returned unchanged when provided'
);
assert.deepEqual(
  resolveExecutionOrder({ jobs: 0, grammarKeys: [] }),
  [],
  'expected empty scheduler plans to resolve to an empty execution order'
);
assert.throws(
  () => resolveExecutionOrder({ grammarKeys: ['native:lua'] }),
  /missing executionOrder/i,
  'expected runner to fail closed when executionOrder is missing'
);

console.log('tree-sitter scheduler warm-pool task planner test passed');
