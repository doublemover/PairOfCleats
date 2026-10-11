import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { createStage1TimingBreakdownTracker } from '../../../src/index/build/indexer/steps/process-files/stage-timing.js';
import { buildStage1ProcessingStallSnapshot, createStage1WatchdogCallback } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';
import { initBuildState, markBuildPhase, updateBuildState, flushBuildState } from '../../../src/index/build/build-state.js';
import { markFailedPhases, toPhaseFailureDetail } from '../../../src/integrations/core/build-index/stages/phase-failures.js';
import { preloadFileCompletions } from '../../../src/index/build/incremental/file-completion.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

// Execute the real processing closure with its actual timing owner. A helper-only
// test missed the stale free variable introduced when timing was extracted.
const source = await fs.readFile(new URL('../../../src/index/build/indexer/steps/process-files.js', import.meta.url), 'utf8');
const syntax = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const stack = [syntax]; let initializer = null;
while (stack.length) {
  const node = stack.pop();
  if (node.type === 'VariableDeclarator' && node.id.name === 'buildProcessingStallSnapshot') initializer = node.init;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) stack.push(child);
    } else if (value?.type) stack.push(value);
  }
}
assert.ok(initializer, 'the real processing snapshot closure must be exercised');
const tracker = createStage1TimingBreakdownTracker();
tracker.observeQueueDelay(8); tracker.observeQueueDelay(24);
const queueSnapshot = tracker.getQueueDelaySummary(); queueSnapshot.count = 999;
assert.equal(tracker.getQueueDelaySummary().count, 2, 'diagnostics cannot mutate timing state');
const buildSnapshot = vm.runInNewContext('(' + source.slice(initializer.start, initializer.end) + ')', {
  buildStage1ProcessingStallSnapshot, stageTimingTracker: tracker,
  getOrderedPendingCount: () => 1, resolveStage1LastActivityAt: () => Date.now() - 5000,
  progress: { count: 4933, total: 8249 }, processStart: Date.now() - 10000,
  inFlightFiles: new Map([['file', { file: 'pending.js', orderIndex: 7, startedAt: Date.now() - 5000 }]]),
  orderedAppender: { snapshot: () => ({ pendingCount: 1, totalSeqCount: 8249, terminalCount: 4933 }) },
  postingsQueue: null, resolveStage1WindowSnapshot: () => null, stage1OwnershipPrefix: 'fixture:', runtime: {}
});
const snapshot = buildSnapshot({ idleMs: 5000, includeStack: true });
assert.deepEqual(snapshot.queueDelayMs, { count: 2, avgMs: 16, maxMs: 24 });
assert.equal(snapshot.progressDone, 4933); assert.equal(snapshot.progressTotal, 8249);
assert.equal(snapshot.stalledFiles[0].file, 'pending.js');
assert.ok(snapshot.process.stack.frames.length);
tracker.observeQueueDelay(40);
assert.equal(buildSnapshot().queueDelayMs.avgMs, 24, 'later snapshots read current timing state');

const fixture = await createSemanticCacheFixture();
try {
  const completed = await fixture.createFile();
  const statePath = path.join(fixture.buildRoot, 'build_state.json');
  await initBuildState({ buildRoot: fixture.buildRoot, buildId: 'interrupted', repoRoot: fixture.repoRoot, modes: ['code'], stage: 'stage2' });
  await markBuildPhase(fixture.buildRoot, 'stage2', 'running');
  await updateBuildState(fixture.buildRoot, { heartbeat: { stage: 'stage2', lastHeartbeatAt: '2000-01-01T00:00:00.000Z' },
    progress: { code: { processedFiles: 4933, totalFiles: 8249, updatedAt: '2000-01-01T00:00:00.000Z' } } });
  await flushBuildState(fixture.buildRoot);
  const staleState = await fs.readFile(statePath), completionPath = path.join(fixture.bundleDir, 'completions', completed.entry.completionKey + '.json');
  const completionBefore = await fs.readFile(completionPath);
  const incrementalState = { enabled: true, bundleDir: fixture.bundleDir, manifest: { ...fixture.manifest, files: {} } };
  const admitted = await preloadFileCompletions({ entries: [{ abs: path.join(fixture.repoRoot, completed.file), rel: completed.file }], incrementalState,
    semanticContext: { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot, dependencySignatures: fixture.dependencies, diskAccount: fixture.account } });
  assert.equal(admitted.size, 1, 'stale running metadata and absent publication do not invalidate durable per-file evidence');
  assert.deepEqual(await fs.readFile(statePath), staleState, 'replay preserves the abandoned run metadata as evidence');
  assert.deepEqual(await fs.readFile(completionPath), completionBefore);

  const controller = new AbortController(); let callbackCount = 0;
  const cause = new ReferenceError('diagnostic fault');
  const appender = buildOrderedAppender(async () => {}, {}, { expectedCount: 4, startIndex: 0, maxPendingBeforeBackpressure: 2 });
  const queued = Promise.all([1, 2, 3].map(index => appender.enqueue(index, {}).catch(error => error)));
  const capacity = appender.waitForCapacity().catch(error => error);
  const failure = await new Promise(resolve => {
    const callback = createStage1WatchdogCallback({ signal: controller.signal,
      run: () => { callbackCount++; throw cause; },
      onError: error => { appender.abort(error); controller.abort(error); resolve(error); } });
    setTimeout(() => { callback(); callback(); }, 1);
  });
  assert.equal(await capacity, failure); await queued;
  assert.equal(callbackCount, 1); assert.equal(failure.cause, cause); assert.equal(failure.code, 'ERR_STAGE1_WATCHDOG');
  await markFailedPhases({ buildRoot: fixture.buildRoot, markPhase: markBuildPhase,
    phaseFailureDetail: toPhaseFailureDetail(failure), phases: [{ name: 'stage2', running: true, done: false }] });
  await flushBuildState(fixture.buildRoot);
  const failed = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(failed.phases.stage2.status, 'failed'); assert.ok(failed.phases.stage2.finishedAt);
  assert.match(failed.phases.stage2.detail, /ERR_STAGE1_WATCHDOG.*diagnostic fault/);
  const progress = JSON.parse(await fs.readFile(path.join(fixture.buildRoot, 'build_state.progress.json'), 'utf8'));
  assert.equal(progress.code.processedFiles, 4933);
  assert.deepEqual(await fs.readFile(completionPath), completionBefore, 'failure bookkeeping preserves reusable completion bytes');
} finally { await fixture.cleanup(); }
console.log('Real watchdog snapshot scope, timer failure bookkeeping, and stale-state completion replay passed');
