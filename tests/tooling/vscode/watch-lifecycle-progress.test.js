import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { readWatchProgress, describeWatchProgress } = require('../../../extensions/vscode/watch-progress.js');
const { applyProgressEvent } = require('../../../extensions/vscode/progress-view.js');
const frame = { proto: 'poc.progress@2', event: 'task:progress', ts: '2026-10-22T12:00:00.000Z',
  taskId: 'watch:monitor', stage: 'watch', phase: 'monitoring', state: 'idle', status: 'running',
  watchReady: true, quiescent: true, backlogDepth: 0, pendingReplay: false, publicationCommitted: false,
  readiness: { watcher: true, publishedGeneration: false, searchReady: null }, message: 'Canonical idle watcher' };
const observed = readWatchProgress(frame);
assert.equal(observed.phase, 'idle-watch');
assert.equal(observed.searchReady, null);
assert.equal(observed.publishedBuildId, null);
assert.equal(readWatchProgress({ ...frame, quiescent: false }), null);
assert.equal(readWatchProgress({ ...frame, backlogDepth: 1 }), null);
assert.equal(readWatchProgress({ ...frame, watchReady: false }), null);
assert.equal(readWatchProgress({ ...frame, readiness: { ...frame.readiness, searchReady: true } }), null);
assert.equal(readWatchProgress({ ...frame, ts: 'invented timestamp' }), null);
const publication = readWatchProgress({ ...frame, publicationCommitted: true,
  readiness: { ...frame.readiness, publishedGeneration: true },
  lastConsistentGeneration: { buildId: 'committed-watch-build', publicationCommitted: true } });
assert.equal(publication.publishedBuildId, 'committed-watch-build');
assert.match(describeWatchProgress(publication).join('\n'), /Search\/backend readiness: unknown/);
const failed = { ...frame, event: 'task:end', phase: 'degraded', state: 'degraded', status: 'failed',
  watchReady: false, ownershipPending: true, degradedReason: 'teardown', errorCode: 'EACCES',
  readiness: { watcher: false, publishedGeneration: false, searchReady: null } };
assert.equal(readWatchProgress(failed).ownershipPending, true);
assert.equal(readWatchProgress({ ...failed, phase: 'stopped' }), null);
const state = applyProgressEvent({ phase: 'starting' }, frame);
assert.equal(state.phase, 'idle-watch');
const degraded = applyProgressEvent(state, { ...failed, event: 'task:progress' });
assert.equal(degraded.phase, 'degraded');
assert.equal(applyProgressEvent(degraded, { proto: 'poc.progress@2', event: 'task:progress',
  ts: frame.ts, stage: 'parse' }).phase, 'degraded', 'nested job output cannot erase an unrecovered watch failure');

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-watch-lifecycle-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root,
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
try {
  harness.activate();
  harness.queuedResults.push({ persistent: true, stderr: JSON.stringify(frame) + '\n' });
  await harness.runCommand('pairofcleats.indexWatchStart');
  await new Promise(setImmediate);
  const session = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  const child = harness.spawnCalls[0].child;
  harness.quickPickQueue.push(items => items.find(item => item.entry.sessionId === session.sessionId), 'Inspect Logs');
  await harness.runCommand('pairofcleats.inspectTasks');
  assert.ok(harness.openedDocuments.some(document => /idle-watch/.test(document.uri?.content || '')
    && /Search\/backend readiness: unknown/.test(document.uri?.content || '')));
  child.kill = () => true;
  const stopping = harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.indexWatchStart' }, { sessionId: session.sessionId });
  await new Promise(setImmediate);
  child.stderr.emit('data', Buffer.from(JSON.stringify(failed) + '\n'));
  child.emit('close', 0);
  await stopping;
  const completed = harness.workspaceStateStore.get('pairofcleats.workflowSessions').find(row => row.sessionId === session.sessionId);
  assert.equal(completed.status, 'failed', 'canonical pending teardown cannot become cancelled success after zero exit');
  await harness.runCommand('pairofcleats.indexWatchStart');
  assert.equal(harness.spawnCalls.length, 1, 'pending canonical watch ownership blocks automatic replacement');
} finally {
  const shutdown = await harness.extension.deactivate();
  assert.equal(shutdown.ok, false, 'closed process handles do not erase canonical pending ownership during shutdown');
  assert.equal(shutdown.pendingOwners.length, 1);
  harness.restoreGlobals();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Canonical watch lifecycle distinguishes idle/admission/publication/search readiness and retains teardown failure');
