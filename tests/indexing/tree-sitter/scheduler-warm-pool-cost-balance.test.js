import assert from 'node:assert/strict';
import { buildWarmPoolTasks } from '../../../src/index/build/tree-sitter-scheduler/runner/task-scheduler.js';

const costs = [100, 1, 100, 1, 100, 1, 100, 1];
const executionOrder = costs.map((_, index) => `cpp~b${index}~w01`);
const groupMetaByGrammarKey = Object.fromEntries(executionOrder.map((key, index) => [key, {
  baseGrammarKey: 'cpp', estimatedParseCost: costs[index]
}]));
const input = { executionOrder, groupMetaByGrammarKey, schedulerConfig: { warmPoolPerGrammar: 2 }, execConcurrency: 4 };
const tasks = buildWarmPoolTasks(input);
assert.deepEqual(tasks, buildWarmPoolTasks(input), 'assignment must be deterministic');
assert.deepEqual(tasks.map(task => task.estimatedParseCost), [202, 202]);
const previousLoads = costs.reduce((loads, cost, index) => { loads[index % 2] += cost; return loads; }, [0, 0]);
assert.equal(Math.max(...previousLoads), 400);
assert.equal(Math.max(...tasks.map(task => task.estimatedParseCost)), 202);
assert.equal(tasks.every(task => task.costBalanced), true);
assert.deepEqual(tasks.flatMap(task => task.grammarKeys).sort(), executionOrder.slice().sort());
for (const task of tasks) {
  const indexes = task.grammarKeys.map(key => executionOrder.indexOf(key));
  assert.deepEqual(indexes, indexes.slice().sort((a, b) => a - b), 'canonical wave order within each parser');
}
// Missing measurements must not be silently scored as zero-cost work.
const mixed = { ...groupMetaByGrammarKey, [executionOrder[0]]: { baseGrammarKey: 'cpp' } };
const fallback = buildWarmPoolTasks({ ...input, groupMetaByGrammarKey: mixed });
assert.deepEqual(fallback.map(task => task.grammarKeys), [executionOrder.filter((_, i) => i % 2 === 0), executionOrder.filter((_, i) => i % 2 === 1)]);
assert.equal(fallback.every(task => task.estimatedParseCost === null && !task.costBalanced), true);
const single = buildWarmPoolTasks({ ...input, schedulerConfig: { warmPoolPerGrammar: 1 } });
assert.deepEqual(single[0].grammarKeys, executionOrder);
assert.equal(single[0].estimatedParseCost, 404);
console.log('warm-pool skew fixture: predicted tail 400 -> 202 cost units; exact coverage and canonical per-lane order preserved (synthetic, not wall-clock speedup)');
