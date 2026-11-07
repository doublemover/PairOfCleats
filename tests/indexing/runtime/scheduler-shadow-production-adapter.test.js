import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
import { attachStage1SchedulerShadow } from '../../../src/index/build/runtime/scheduler-shadow-adapter.js';
import { createPerfProfile, recordFileMetric, finalizePerfProfile } from '../../../src/index/build/perf-profile.js';
import { collectRuntimeResourceEvidence } from '../../../src/index/build/runtime/receipt.js';

const scheduler = createBuildScheduler({ cpuTokens: 1, queues: { file: { concurrency: 1 } } });
const queue = createSchedulerQueueAdapter({ scheduler, queueName: 'file', tokens: { cpu: 1 }, concurrency: 1 });
const features = { lint: true };
const runtime = { scheduler, buildId: 'previous', configHash: 'config', languageOptions: { js: 'babel' },
  stageProducer: { identity: 'exact-producer', evidenceScope: 'observed-implementation-files-and-bootstrap-receipt' },
  stageReuseEnvironment: {}, learnedAutoProfile: { enabled: true, features: { files: 2, bytes: 200 } } };
const previous = createPerfProfile({ configHash: 'config', mode: 'code', buildId: 'previous', features });
let frontier = 0;
const attach = (profile, previousProfile) => attachStage1SchedulerShadow({ runtime, mode: 'code',
  perfProfile: profile, previousProfile, orderedAppender: { peekNextIndex: () => frontier },
  resolveOrderIndex: (_entry, index) => index });
try {
  attach(previous, null);
  assert.ok(previous.schedulerReplayIdentity, 'the production adapter stamps prospective compatibility');
  recordFileMetric(previous, { languageId: 'javascript', bytes: 100, lines: 1, durationMs: 10 });
  finalizePerfProfile(previous);
  runtime.buildId = 'current';
  const current = createPerfProfile({ configHash: 'config', mode: 'code', buildId: 'current', features });
  const shadow = attach(current, previous);
  assert.equal(shadow.context.getCommitState().maxAhead, null, 'soft windows do not prove a hard frontier bound');
  const pendingCommits = [];
  await runWithQueue(queue, [{ abs: 'hidden/source.js', stat: { size: 100 } }], () => 'parsed', {
    schedulerMetadata: shadow.metadata,
    onResult: (_result, ctx) => {
      const identity = shadow.captureCommitIdentity(ctx.index);
      assert.ok(identity);
      pendingCommits.push(() => { shadow.noteCommitted(scheduler, ctx.index, { identity }); frontier++; });
    }
  });
  assert.equal(scheduler.getDispatchReplay().tasks[0].committedAt, null, 'queue result is not ordered commit');
  pendingCommits[0]();
  const replay = scheduler.getDispatchReplay();
  assert.notEqual(replay.tasks[0].committedAt, null);
  assert.equal(replay.comparison.summary.evaluable, 0);
  assert.ok(replay.comparison.summary.exclusions['missing-commit-frontier'] > 0);
  const evidence = collectRuntimeResourceEvidence(runtime);
  assert.equal(evidence.scheduler.dispatchReplay.summary.evaluable, 0);
  assert.equal(evidence.scheduler.dispatchReplay.fullTraceIncluded, false);
  assert.equal(evidence.scheduler.queues.file.configuredConcurrency, 1);
  assert.equal(evidence.scheduler.queues.file.adapterConcurrency, 1);
  assert.equal('tasks' in evidence.scheduler.dispatchReplay, false);
  assert.equal(JSON.stringify(evidence).includes('hidden/source.js'), false);
  runtime.stageProducer = { identity: null };
  const unknown = attach(createPerfProfile({ features }), previous);
  assert.equal(unknown.metadata({ abs: 'source.js', stat: { size: 100 } }, { index: 0 }).profileIdentity, null);
  runtime.learnedAutoProfile.enabled = false;
  assert.equal(attach(createPerfProfile({ features }), previous).metadata, null);
  assert.equal('dispatchReplay' in collectRuntimeResourceEvidence(runtime).scheduler, false);
} finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
console.log('Production shadow retains unknown frontier constraints and observes actual ordered commits.');
