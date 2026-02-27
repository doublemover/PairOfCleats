#!/usr/bin/env node
import assert from 'node:assert/strict';
import os from 'node:os';
import { resolveExecConcurrency } from '../../../src/index/build/tree-sitter-scheduler/runner/task-scheduler.js';

const originalAvailableParallelism = os.availableParallelism;
let patched = false;

try {
  Object.defineProperty(os, 'availableParallelism', {
    configurable: true,
    value: () => 64
  });
  patched = true;
} catch {}

const resolved = resolveExecConcurrency({
  schedulerConfig: {},
  grammarCount: 64
});
if (patched) {
  assert.equal(resolved, 16, 'expected auto exec concurrency to cap at 16 for high-core hosts');
} else {
  assert.ok(resolved >= 1, 'expected non-zero exec concurrency when monkey patch unavailable');
}

const configured = resolveExecConcurrency({
  schedulerConfig: { execConcurrency: 5 },
  grammarCount: 64
});
assert.equal(configured, 5, 'expected explicit scheduler config to override auto cap');

if (patched) {
  Object.defineProperty(os, 'availableParallelism', {
    configurable: true,
    value: originalAvailableParallelism
  });
}

console.log('tree-sitter scheduler exec concurrency cap test passed');
