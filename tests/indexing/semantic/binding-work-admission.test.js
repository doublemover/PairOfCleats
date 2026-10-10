#!/usr/bin/env node
import assert from 'node:assert/strict';
import { prepareSemanticBindingWork } from '../../../src/index/semantic/build-frontier.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createBindingWorkFixture } from '../../helpers/semantic-binding-work.js';

for (const bindings of ['auto', 'eager']) {
  const fixture = await createBindingWorkFixture({ bindings });
  try {
    const work = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
    const result = await work.run(fixture.emitBindings);
    assert.equal(result.ran, true);
    assert.deepEqual(fixture.state.semanticCompletedTasks, [result.receipt]);
    const control = fixture.openControl();
    try {
      assert.equal(control.getTask(work.task.taskId).state, 'leased', 'durable analysis is not completed before normal publication');
      assert.equal(control.getOutput(work.task.taskId), null);
    } finally { control.close(); }
    assert.ok([...fixture.state.semanticFactsByFile.values()].some(entry => entry.partitions.some(partition => partition.members.semantic_frontier.length)),
      'checker outputs retain the immutable pending task partition');
  } finally { await fixture.cleanup(); }
}
const partial = await createBindingWorkFixture({ bindings: 'deferred', deferredDrain: 'after-index' });
try {
  const work = await prepareSemanticBindingWork({ state: partial.state, runtime: partial.runtime });
  assert.equal((await work.run(args => partial.emitBindings({ ...args, onlyFirst: true }))).reason, 'binding_source_inventory_incomplete');
  assert.equal(partial.state.semanticCompletedTasks, undefined);
  const control = partial.openControl();
  try { assert.equal(control.getTask(work.task.taskId).state, 'pending'); } finally { control.close(); }
} finally { await partial.cleanup(); }
const budget = await createBindingWorkFixture({ bindings: 'deferred', deferredDrain: 'after-index', afterIndexMaxMs: 5 });
try {
  const work = await prepareSemanticBindingWork({ state: budget.state, runtime: budget.runtime });
  const result = await work.run(async ({ signal }) => {
    await new Promise(resolve => setTimeout(resolve, 15)); throwIfAborted(signal);
    return budget.emitBindings({ signal });
  });
  assert.equal(result.reason, 'after_index_budget_exhausted');
  assert.equal(budget.state.semanticCompletedTasks, undefined);
  const control = budget.openControl();
  try { assert.equal(control.getTask(work.task.taskId).state, 'pending'); } finally { control.close(); }
} finally { await budget.cleanup(); }
console.log('binding scheduler admission, complete output receipts, partial inventory and cooperative deadline preserve pending work');
