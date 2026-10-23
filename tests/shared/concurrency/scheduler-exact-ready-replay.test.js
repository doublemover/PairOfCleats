import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { compareSchedulerDispatchReplay } from '../../../src/shared/concurrency/scheduler-dispatch-replay.js';

// AUTHORED actual-dispatch evidence controls; execution deferred.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'decisions';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1, starvationMs: 100,
  maxInFlightBytes: 1000, queues: { file: { concurrency: 1 }, memory: {}, write: {} },
  writeBackpressure: { enabled: true, writeQueue: 'write', producerQueues: ['file'], pendingThreshold: 1 } });
const sequence = [];
const gate = deferred();
const compatibilityIdentity = 'exact-compatible-profile';
const resourceIdentity = scheduler.getDispatchReplayResourceIdentity();
const shadow = (orderIndex, predictedDurationMs = 5) => ({ domain: 'code', orderIndex, dependencyState: 'ready',
  predictedDurationMs, predictedBytes: 10, profileIdentity: 'prior-profile', compatibilityIdentity,
  resourceIdentity, featureIdentity: 'qualified-repository-features' });
scheduler.setDispatchReplayContext({ enabled: true, compatibilityIdentity,
  getCommitState: () => ({ domain: 'code', nextIndex: 0, maxAhead: 8 }) });
const blocker = scheduler.schedule('file', { cpu: 1, mem: 1, bytes: 10, shadow: shadow(0) }, async () => {
  sequence.push('blocker'); await gate.promise; now += 5;
});
try {
  await tick();
  if (selected === 'blocked') {
    const memory = scheduler.schedule('memory', { cpu: 0, mem: 1, bytes: 10 }, () => sequence.push('memory'));
    const writer = scheduler.schedule('write', { cpu: 1, bytes: 10 }, () => sequence.push('writer'));
    const file = scheduler.schedule('file', { cpu: 1, bytes: 10, shadow: shadow(1) }, () => sequence.push('file'));
    gate.resolve(); await Promise.all([blocker, memory, writer, file]);
    const trace = scheduler.getDispatchReplay();
    assert.ok(trace.decisions.some(decision => decision.candidates.some(row => row.admissionReason === 'write-backpressure')));
    assert.ok(trace.comparison.summary.exclusions['missing-prediction'] > 0,
      'unqualified writer/memory candidates cannot be fabricated into an evaluable set');
  } else if (selected === 'bounded') {
    const tasks = Array.from({ length: 560 }, (_, index) => scheduler.schedule('file', { cpu: 1, bytes: 1,
      shadow: shadow(index + 1) }, () => undefined));
    gate.resolve(); await Promise.all([blocker, ...tasks]);
    const trace = scheduler.getDispatchReplay();
    assert.ok(trace.decisions.some(decision => !decision.completeReadySet && decision.incompleteReason === 'ready-set-limit'));
    assert.ok(trace.tasks.length <= trace.limits.tasks);
    assert.ok(trace.decisions.length <= trace.limits.decisions);
    assert.ok(trace.retainedBytes <= trace.limits.bytes);
    assert.ok(trace.droppedTasks > 0 && trace.droppedDecisions > 0);
  } else {
    const slow = scheduler.schedule('file', { cpu: 1, bytes: 10, shadow: shadow(1, 40) }, () => { sequence.push('slow'); now += 40; });
    const fast = scheduler.schedule('file', { cpu: 1, bytes: 10, shadow: shadow(2, 2) }, () => { sequence.push('fast'); now += 2; });
    const tied = scheduler.schedule('file', { cpu: 1, bytes: 10, shadow: shadow(3, 2) }, () => { sequence.push('tied'); now += 2; });
    const abort = new AbortController();
    const canceled = scheduler.schedule('file', { cpu: 1, shadow: shadow(4), signal: abort.signal }, () => assert.fail('aborted task ran'));
    const cancellation = assert.rejects(canceled, { name: 'AbortError' }); abort.abort(); await cancellation;
    assert.ok(scheduler.getDispatchReplay().comparison.summary.incompleteOutcomes > 0);
    gate.resolve(); await Promise.all([blocker, slow, fast, tied]);
    now += 10; scheduler.noteDispatchReplayCommit({ domain: 'code', orderIndex: 1 });
    const trace = scheduler.getDispatchReplay();
    assert.deepEqual(sequence, ['blocker', 'slow', 'fast', 'tied'], 'shadow leaves actual queue FIFO unchanged');
    const slowTask = trace.tasks.find(task => task.prediction?.orderIndex === 1);
    const fastTask = trace.tasks.find(task => task.prediction?.orderIndex === 2);
    const decision = trace.comparison.decisions.find(row => row.baselineTaskId === slowTask.id);
    assert.equal(decision.proposedTaskId, fastTask.id, 'same exact ready set chooses shortest prediction, ties use enqueue ordinal');
    assert.equal(decision.evaluable, true);
    assert.equal(trace.tasks.find(task => task.prediction?.orderIndex === 4).outcome, 'rejected');
    assert.ok(trace.comparison.summary.commitDelayP95Ms >= 10);
    if (selected === 'constraints') {
      const replay = change => { const copy = structuredClone(trace); change(copy); return compareSchedulerDispatchReplay(copy); };
      assert.ok(replay(copy => { copy.tasks.forEach(task => { if (task.prediction) task.prediction.compatibilityIdentity = 'stale'; }); })
        .summary.exclusions['profile-mismatch'] > 0);
      assert.ok(replay(copy => { copy.tasks.forEach(task => { if (task.prediction) task.prediction.resourceIdentity = 'different-envelope'; }); })
        .summary.exclusions['resource-envelope-change'] > 0);
      assert.ok(replay(copy => { copy.decisions.forEach(row => { row.commit = null; }); }).summary.exclusions['missing-commit-frontier'] > 0);
      assert.ok(replay(copy => { copy.tasks[0].startedAt = -1; }).summary.exclusions['malformed-task-order'] > 0);
      const aged = replay(copy => { copy.decisions.forEach(row => { row.starvationMs = 0; }); });
      assert.equal(aged.decisions.find(row => row.baselineTaskId === slowTask.id).proposedTaskId, slowTask.id);
      const frontier = replay(copy => { copy.decisions.forEach(row => { if (row.baselineTaskId === slowTask.id) row.commit.nextIndex = 1; }); });
      assert.equal(frontier.decisions.find(row => row.baselineTaskId === slowTask.id).reason, 'contiguous-commit-frontier');
      assert.equal(compareSchedulerDispatchReplay({ version: 1, tasks: [], decisions: [null] }).summary.exclusions['invalid-decision-record'], 1);
      assert.equal(compareSchedulerDispatchReplay({}).summary.exclusions['invalid-trace'], 1);
    }
    trace.tasks.length = 0;
    assert.ok(scheduler.getDispatchReplay().tasks.length > 0, 'callers cannot mutate retained evidence');
  }
} finally {
  gate.resolve(); await Promise.allSettled([blocker]); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  Date.now = originalNow;
}
console.log(`exact-ready replay ${selected} source controls authored`);
