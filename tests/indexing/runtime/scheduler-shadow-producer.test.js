import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
import { createPerfProfile, recordFileMetric, finalizePerfProfile } from '../../../src/index/build/perf-profile.js';
import { createSchedulerReplayProfileIdentity, createFileSchedulerShadow } from '../../../src/index/build/runtime/scheduler-shadow.js';

// AUTHORED: real producer/admission path, prior-profile snapshots and no current-run fitting.
const scheduler = createBuildScheduler({ cpuTokens: 1, queues: { file: { concurrency: 1 } } });
const queue = createSchedulerQueueAdapter({ scheduler, queueName: 'file', tokens: { cpu: 1 }, concurrency: 1 });
const features = { lint: true, complexity: true };
const identity = createSchedulerReplayProfileIdentity({ configHash: 'config', mode: 'code', parserIdentity: { js: 'babel' },
  runtimeIdentity: { node: process.versions.node, platform: process.platform }, repositoryFeatures: { files: 3, bytes: 300 },
  features, resourceIdentity: scheduler.getDispatchReplayResourceIdentity() });
assert.ok(identity);
const prior = createPerfProfile({ configHash: 'config', mode: 'code', buildId: 'prior-build', features });
recordFileMetric(prior, { languageId: 'javascript', bytes: 100, lines: 1, durationMs: 10 });
finalizePerfProfile(prior); prior.schedulerReplayIdentity = identity;
let frontier = 0;
const options = { learnedAutoProfile: { enabled: true }, perfProfile: prior, identity, mode: 'code', currentBuildId: 'current-build',
  getCommitState: () => ({ nextIndex: frontier, maxAhead: 3 }), resolveOrderIndex: (_entry, index) => index };
const shadow = createFileSchedulerShadow(options);
scheduler.setDispatchReplayContext(shadow.context);
const source = { abs: 'private/source.js', rel: 'private/source.js', stat: { size: 100 }, lines: 1 };
const before = shadow.metadata(source, { index: 1 });
assert.ok(before.predictedDurationMs > 0);
prior.totals.byteCostMs = 9999; prior.languages.javascript.buckets.xs.byteCostMs = 9999;
assert.equal(shadow.metadata(source, { index: 1 }).predictedDurationMs, before.predictedDurationMs,
  'mutable caller profile cannot alter frozen prior predictions or their identity');
assert.equal(createFileSchedulerShadow({ ...options, currentBuildId: 'prior-build' }).metadata(source, { index: 1 }).predictedDurationMs,
  null, 'current-build duration cannot leak into prediction');
assert.equal(createFileSchedulerShadow({ ...options, identity: { ...identity, compatibilityIdentity: 'stale' } })
  .metadata(source, { index: 1 }).profileIdentity, null);
assert.equal(createFileSchedulerShadow({ ...options, learnedAutoProfile: { enabled: false } }).metadata, null);
const order = [];
try {
  await runWithQueue(queue, [source, { ...source, stat: { size: 50 } }], async (_entry, ctx) => {
    order.push(ctx.index); await tick(); return ctx.index;
  }, { schedulerMetadata: shadow.metadata, estimateBytes: entry => entry.stat.size,
    onBeforeDispatch: () => undefined,
    onResult: (_result, ctx) => {
      const attempt = shadow.captureCommitIdentity(ctx.index);
      shadow.noteCommitted(scheduler, ctx.index, { identity: attempt, status: 'completed' }); frontier++;
    } });
  const trace = scheduler.getDispatchReplay();
  assert.deepEqual(order, [0, 1]);
  assert.equal(trace.tasks.length, 2);
  assert.ok(trace.tasks.every(task => task.prediction?.profileIdentity && task.committedAt != null));
  assert.ok(trace.comparison.summary.evaluable > 0);
  assert.equal(JSON.stringify(trace).includes('private/source.js'), false, 'bounded evidence redacts file paths');
  assert.deepEqual(await runWithQueue(queue, [source], () => 'ordinary', { schedulerMetadata: () => { throw new Error('observer failed'); } }),
    ['ordinary'], 'failed instrumentation cannot change actual task result');
  assert.ok(scheduler.getDispatchReplay().comparison.summary.exclusions['missing-prediction'] > 0);
} finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
console.log('learned opt-in producer reaches exact scheduler replay without changing live selection');
