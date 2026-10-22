#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chooseMeasuredWarmLaneCount, mergeWarmLaneObservation } from '../../../src/index/build/tree-sitter-scheduler/warm-lane-profile.js';
import { buildWarmPoolTasks } from '../../../src/index/build/tree-sitter-scheduler/runner/task-scheduler.js';
import { prepareTreeSitterSchedulerTasks } from '../../../src/index/build/tree-sitter-scheduler/runner/task-preparation.js';
import { mergeTreeSitterSchedulerAdaptiveProfile } from '../../../src/index/build/tree-sitter-scheduler/adaptive-profile.js';
const identity = 'a'.repeat(64), nowMs = Date.now(), at = new Date(nowMs).toISOString();
const history = { identity, samples: 3, startupMs: 10, memoryBytes: 100000, costPerMs: 1, at };
const common = { history, identity, execConcurrency: 8, nowMs, executionBudget: { effective: 8, availableMemoryBytes: 10000000, perChildMb: 0 } };
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: Array(7).fill(1) }).laneCount, 1);
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: Array(7).fill(10000) }).laneCount, 7);
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: [10000] }).laneCount, 1);
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: [10000, 1, 1, 1, 1, 1, 1] }).laneCount, 1, 'one unsplittable tail does not justify seven caches');
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: Array(7).fill(10000),
  executionBudget: { effective: 8, availableMemoryBytes: 210000, perChildMb: 0 } }).laneCount, 2);
for (const invalid of [{ ...history, samples: 2 }, { ...history, identity: 'b'.repeat(64) },
  { ...history, at: new Date(nowMs - 8 * 86400000).toISOString() }, { ...history, memoryBytes: 0 }]) {
  assert.equal(chooseMeasuredWarmLaneCount({ ...common, history: invalid, costs: [100, 100] }), null);
}
assert.equal(chooseMeasuredWarmLaneCount({ ...common, costs: [100, null] }), null);
assert.equal(mergeWarmLaneObservation(history, { ...history, samples: 1, memoryBytes: 200000 }).memoryBytes, 200000);
const merged = mergeTreeSitterSchedulerAdaptiveProfile(new Map(), [{ baseGrammarKey: 'cpp', rows: 7,
  durationMs: 700, estimatedParseCost: 700, warmLane: history }]);
assert.deepEqual(merged.get('cpp').warmLane, history);
const executionOrder = Array.from({ length: 7 }, (_, index) => 'cpp~w' + index);
const groupMeta = Object.fromEntries(executionOrder.map(key => [key, { baseGrammarKey: 'cpp', jobs: 1, estimatedParseCost: 10000 }]));
const tasks = buildWarmPoolTasks({ executionOrder, groupMetaByGrammarKey: groupMeta, schedulerConfig: {}, execConcurrency: 8,
  executionBudget: common.executionBudget, warmLaneHistory: { cpp: history }, warmLaneProfileIdentity: identity, nowMs });
assert.equal(tasks.length, 7); assert.equal(tasks.every(task => task.laneDecision.reason === 'qualified-cost-startup-memory'), true);
assert.deepEqual(tasks.flatMap(task => task.grammarKeys).sort(), executionOrder.slice().sort());
const unknown = buildWarmPoolTasks({ executionOrder, groupMetaByGrammarKey: groupMeta, schedulerConfig: {}, execConcurrency: 8 });
assert.equal(unknown.length, 1, 'unknown profile preserves previous conservative small-key fallback');
assert.deepEqual(buildWarmPoolTasks({ executionOrder: [], groupMetaByGrammarKey: {}, schedulerConfig: {}, execConcurrency: 8 }), []);
// Production preparation carries selected profile metadata to task decisions.
const prepared = prepareTreeSitterSchedulerTasks({ planResult: {
  groups: executionOrder.map(grammarKey => ({ grammarKey, baseGrammarKey: 'cpp', jobs: [] })),
  plan: { executionOrder, groupMeta, warmLaneHistory: { cpp: history }, warmLaneProfileIdentity: identity }
}, schedulerConfig: { execConcurrency: 8 } });
assert.equal(prepared.plannedTasks.length, 7);
