#!/usr/bin/env node
import assert from 'node:assert/strict';
import { prepareSemanticBindingWork } from '../../../src/index/semantic/build-frontier.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { createBindingWorkFixture } from '../../helpers/semantic-binding-work.js';

for (const [cap, reason] of [
  ['maxInFlightBytes', 'scheduler_relations_bytes_exceeded'],
  ['maxPendingBytes', 'scheduler_relations_pending_bytes_exceeded']
]) {
  const fixture = await createBindingWorkFixture({ bindings: 'eager' });
  try {
    fixture.runtime.scheduler.registerQueue(SCHEDULER_QUEUE_NAMES.stage2Relations, { [cap]: 1024 });
    const work = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
    let called = false;
    const result = await work.run(() => { called = true; throw new Error('out-of-budget compiler must not start'); });
    assert.equal(result.ran, false);
    assert.equal(result.reason, reason, 'admission sees the actual configured production queue cap');
    assert.equal(called, false);
    assert.equal(fixture.runtime.scheduler.stats().queues[SCHEDULER_QUEUE_NAMES.stage2Relations].started, 0);
    assert.equal(fixture.runtime.scheduler.stats().queues.relations, undefined);
    assert.deepEqual(result.receipts, []);
    const control = fixture.openControl();
    try {
      assert.equal(control.getTask(work.task.taskId).state, 'pending', 'refusal preserves durable work for a later compatible allowance');
      assert.equal(control.getOutput(work.task.taskId), null);
    } finally { control.close(); }
  } finally { await fixture.cleanup(); }
}
console.log('compiler admission honors canonical scheduler byte caps before leasing or execution');
