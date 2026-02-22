#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { mergeTreeSitterSchedulerAdaptiveProfile } from '../../../src/index/build/tree-sitter-scheduler/adaptive-profile.js';

applyTestEnv({ testing: '1' });

const initial = new Map([
  ['cpp', {
    rowsPerSec: 1000,
    costPerSec: 35000,
    tailDurationMs: 900,
    laneState: { bucketCount: 3, cooldownSteps: 0, lastAction: 'hold' },
    samples: 2,
    updatedAt: null
  }]
]);

const merged = mergeTreeSitterSchedulerAdaptiveProfile(initial, [
  {
    baseGrammarKey: 'cpp',
    grammarKey: 'cpp~b04of04~w01of02',
    rows: 4000,
    durationMs: 1000,
    estimatedParseCost: 210000,
    laneImbalanceRatio: 1.5,
    at: '2026-02-21T00:00:00.000Z'
  },
  {
    baseGrammarKey: 'cpp',
    grammarKey: 'cpp~b02of02~w01of01',
    rows: 2000,
    durationMs: 1000,
    estimatedParseCost: 70000,
    laneImbalanceRatio: 1.2,
    at: '2026-02-21T00:00:01.000Z'
  },
  {
    baseGrammarKey: 'java',
    grammarKey: 'java~b03of03~w01of01',
    rows: 2000,
    durationMs: 1000,
    estimatedParseCost: 60000
  }
]);

assert.ok(merged.has('cpp'), 'expected existing grammar entry to persist');
assert.ok(merged.has('java'), 'expected new grammar entry to be created');
const cpp = merged.get('cpp');
assert.ok(cpp.rowsPerSec > 1000 && cpp.rowsPerSec < 4000, 'expected EMA merge for existing grammar');
assert.ok(Number(cpp.costPerSec) > 0, 'expected cost throughput to be tracked');
assert.ok(Number(cpp.msPerRow) > 0, 'expected msPerRow telemetry');
assert.ok(Number(cpp.tailDurationMs) >= 1000, 'expected sticky tail duration telemetry');
assert.ok(Number(cpp.imbalanceEma) >= 1.2 && Number(cpp.imbalanceEma) <= 1.5, 'expected lane imbalance EMA');
assert.equal(cpp.laneState.bucketCount, 2, 'expected lane state to track latest bucket count');
assert.equal(cpp.laneState.lastAction, 'merge', 'expected lane action to track split/merge direction');
assert.ok(cpp.laneState.cooldownSteps >= 2, 'expected cooldown guardrail steps to be present');
assert.equal(cpp.samples, 4, 'expected sample count increment');

const java = merged.get('java');
assert.equal(java.laneState.bucketCount, 3, 'expected bucketCount to be inferred from grammarKey');

console.log('tree-sitter scheduler adaptive profile test passed');
