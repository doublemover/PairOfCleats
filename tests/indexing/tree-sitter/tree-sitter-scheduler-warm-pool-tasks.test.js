#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { treeSitterSchedulerRunnerInternals } from '../../../src/index/build/tree-sitter-scheduler/runner.js';

applyTestEnv({ testing: '1' });

const { buildWarmPoolTasks } = treeSitterSchedulerRunnerInternals;

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

console.log('tree-sitter scheduler warm-pool task planner test passed');
