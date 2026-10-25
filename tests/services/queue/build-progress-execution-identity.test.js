import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bindClaimedJobExecution, createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';
import { ownsBuildProgress, pickOwnedBuildState, startBuildProgressMonitor } from '../../../tools/service/indexer-service/progress-monitor.js';
import { createQueueClaimFixture } from '../../helpers/queue-claim.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-service-progress-'));
const inherited = { correlation: { correlationId: 'shared-request' } };
const original = { id: 'first', observability: inherited };
const first = bindClaimedJobExecution(original), other = bindClaimedJobExecution({ ...original, id: 'other' });
assert.equal(original.observability, inherited, 'claim metadata is preserved');
assert.equal(original.observability.correlation.correlationId, 'shared-request');
assert.notEqual(first.observability.correlation.correlationId, other.observability.correlation.correlationId);
assert.equal(first.observability.correlation.parentCorrelationId, 'shared-request');
let claimed = false, monitored, executed;
const worker = createQueueWorker({
  queueDir: 'fixture-queue', resolvedQueueName: 'index', staleQueueMaxRetries: 0,
  monitorBuildProgress: true,
  claimNextJob: async (_dir, _queue, options) => claimed ? null
    : (claimed = true, createQueueClaimFixture({ ...original, repo: root, stage: 'stage2' }, options)),
  startBuildProgressMonitor: ({ job }) => { monitored = job; return async () => {}; },
  executeClaimedJob: async ({ job }) => { executed = job; return { handled: false, runResult: { exitCode: 0 } }; },
  touchJobHeartbeat: async () => ({}), requeueStaleJobs: async () => ({}), ensureQueueDir: async () => {},
  finalizeJobRun: async ({ metrics }) => { metrics.succeeded += 1; },
  buildDefaultRunResult: () => ({ exitCode: 1 }), printPayload: () => {}
});
await worker.runBatch(1);
assert.strictEqual(monitored, executed, 'the actual worker hands one execution context to monitor and executor');
assert.notEqual(executed.observability.correlation.correlationId, inherited.correlation.correlationId);
const builds = path.join(root, 'builds'), repo = path.join(root, 'repo');
const state = (buildId, job, processedFiles, status = 'running') => ({
  buildId, buildRoot: path.join(builds, buildId), repoRoot: repo, stage: 'stage2',
  phases: { stage2: { status } }, progress: { code: { processedFiles, totalFiles: 200 } },
  runtime: { latestAttemptId: `${buildId}-attempt`, attempts: [{
    attemptId: `${buildId}-attempt`, buildId, stage: 'stage2', correlationId: job.observability.correlation.correlationId
  }] }
});
const write = async (value) => {
  await fs.mkdir(value.buildRoot, { recursive: true });
  await fs.writeFile(path.join(value.buildRoot, 'build_state.json'), JSON.stringify(value));
};
const logs = [];
let stop;
try {
  await write(state('completed-predecessor', other, 200, 'done'));
  stop = startBuildProgressMonitor({ job: first, repoPath: repo, stage: 'stage2', repoCacheRoot: root, log: line => logs.push(line) });
  await stop.poll();
  assert.match(logs.at(-1), /waiting for owned build state/);
  assert.doesNotMatch(logs.join('\n'), /code 200\/200/);
  const current = state('current', first, 1);
  await write(current);
  await stop.poll();
  assert.match(logs.at(-1), /code 1\/200/);
  const second = state('newer-unrelated', other, 190);
  await write(second);
  await stop.poll();
  assert.doesNotMatch(logs.join('\n'), /code 190\/200/);
  const loaded = await pickOwnedBuildState({ job: other, stage: 'stage2', repoPath: repo,
    candidates: [{ buildRoot: current.buildRoot }, { buildRoot: second.buildRoot }] });
  assert.equal(loaded.state.buildId, 'newer-unrelated');
  assert.equal(ownsBuildProgress({ job: { ...first, buildId: 'different-resume' }, state: current,
    stage: 'stage2', buildRoot: current.buildRoot, repoPath: repo }), false);
  assert.equal(ownsBuildProgress({ job: { ...first, buildId: 'current' }, state: current,
    stage: 'stage2', buildRoot: current.buildRoot, repoPath: repo }), true, 'explicit resume is adopted by execution identity, independent of age');
  current.runtime.attempts.push({ ...current.runtime.attempts[0], attemptId: 'foreign-latest',
    correlationId: other.observability.correlation.correlationId });
  current.runtime.latestAttemptId = 'foreign-latest';
  await write(current);
  await stop.poll();
  assert.match(logs.at(-1), /waiting for owned build state/, 'an older owned attempt cannot certify another execution’s aggregate progress');
  await fs.writeFile(path.join(current.buildRoot, 'build_state.json'), 'broken');
  await stop.poll();
  await fs.rm(current.buildRoot, { recursive: true });
  await stop.poll();
  await stop();
  const before = logs.length;
  await stop.poll();
  assert.equal(logs.length, before, 'cleanup fences future polls and late logging');
} finally {
  await stop?.();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Service progress belongs to the executing claim across predecessor, concurrent, resumed and unreadable states.');
