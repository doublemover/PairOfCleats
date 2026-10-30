import assert from 'node:assert/strict';
import { readEffectiveCpu } from '../../src/shared/effective-cpu.js';
import { resolveExecConcurrency } from '../../src/index/build/tree-sitter-scheduler/runner/task-scheduler.js';
assert.equal(readEffectiveCpu({ availableParallelism: 2, hostCpuCount: 32 }).cpuCount, 2);
assert.equal(resolveExecConcurrency({ schedulerConfig: { execConcurrency: 16 }, grammarCount: 20,
  executionBudget: { effective: 2 } }), 2);
assert.equal(resolveExecConcurrency({ schedulerConfig: { execConcurrency: 1 }, grammarCount: 20,
  executionBudget: { effective: 2 } }), 1);
console.log('effective CPU and parser fanout envelope passed');
