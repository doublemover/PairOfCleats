import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWatchProgress } from '../../../src/index/build/watch/progress.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import { createTempWatchRepo, createWatchRuntime, createWatchDeps, startCodeWatch, waitFor } from './helpers.js';

// Actual watch orchestration and canonical frame writer, with small injected
// discovery/build/watcher owners. This does not qualify a native backend/host.
const frames = [];
const stream = { write: line => { const event = parseProgressEventLine(line); assert.ok(event); frames.push(event); } };
const { tempRoot, repoRoot, files } = await createTempWatchRepo({ prefix: 'watch-structured-progress-',
  files: { one: { rel: 'one.js', content: 'export const one = 1;\n' } } });
const runtime = await createWatchRuntime({ repoRoot }); runtime.argv = { progress: 'jsonl' };
let watcherEvent, watcherError, finishClose, closeStarted, allowValidation = false;
const closeRequested = new Promise(resolve => { closeStarted = resolve; });
const closing = new Promise(resolve => { finishClose = resolve; });
const fixture = createWatchDeps({ entries: [files.one], buildIndexForMode: async () => {},
  validateIndexArtifacts: async () => ({ ok: allowValidation, issues: allowValidation ? [] : ['fixture validation failed'], warnings: [] }) });
const deps = { ...fixture.deps,
  createWatchProgress: ({ runtime }) => createWatchProgress({ runtime, stream }),
  startWatcher: async ({ onEvent, onError }) => {
    watcherEvent = onEvent; watcherError = onError;
    return { close: async () => { closeStarted(); await closing; } };
  } };
const watch = startCodeWatch({ runtime, deps });
try {
  await watch.ready;
  const monitoring = frames.find(event => event.phase === 'monitoring');
  assert.equal(monitoring.state, 'idle'); assert.equal(monitoring.watchReady, true);
  assert.deepEqual(monitoring.readiness, { watcher: true, publishedGeneration: false, searchReady: null });
  assert.equal(monitoring.total, undefined, 'monitoring has no fabricated work total');
  watcherEvent({ type: 'change', absPath: files.one.abs });
  await waitFor(() => frames.some(event => event.degradedReason === 'validation'));
  assert.ok(frames.some(event => event.phase === 'updating' && event.backlogDepth > 0));
  assert.equal(frames.find(event => event.degradedReason === 'validation').watchReady, false);
  allowValidation = true;
  await waitFor(() => frames.some(event => event.phase === 'monitoring' && event.publicationCommitted));
  const restored = frames.findLast(event => event.phase === 'monitoring');
  assert.equal(restored.lastConsistentGeneration.publicationCommitted, true);
  assert.equal(restored.readiness.searchReady, null, 'promotion does not qualify every retrieval backend');
  watcherError(Object.assign(new Error('fixture watcher failure'), { code: 'ERR_FIXTURE_WATCHER' }));
  watcherEvent({ type: 'change', absPath: files.one.abs });
  await waitFor(() => runtime.watchState?.quiescent && !runtime.watchState?.running);
  const degraded = frames.findLast(event => event.event !== 'task:end');
  assert.equal(degraded.phase, 'degraded'); assert.equal(degraded.degradedReason, 'watcher');
  assert.equal(degraded.errorCode, 'ERR_FIXTURE_WATCHER');
  assert.equal(degraded.watchReady, false, 'later successful builds cannot prove watcher recovery');
  watch.abortController.abort(); await closeRequested;
  assert.equal(frames.some(event => event.event === 'task:end'), false, 'requesting close is not actual teardown');
  finishClose(); await watch.watchPromise;
  const terminal = frames.at(-1);
  assert.equal(terminal.event, 'task:end'); assert.equal(terminal.status, 'cancelled');
  assert.equal(terminal.watchReady, false); assert.equal(terminal.readiness.searchReady, null);
} finally {
  watch.abortController.abort(); finishClose();
  await watch.watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}
{
  const events = [], runtime = { argv: { progress: 'jsonl' } };
  const owner = createWatchProgress({ runtime, stream: { write: line => events.push(parseProgressEventLine(line)) } });
  const state = { quiescent: true, backlogDepth: 0, consistency: 'consistent' };
  owner.monitoring(state); owner.degraded('watcher', { code: 'ERR_WATCH' }, state);
  owner.degraded('build', { code: 'ERR_BUILD' }, state); owner.recovered(state);
  assert.deepEqual(events.at(-1).degradedReasons, ['watcher']);
  const count = events.length; owner.observe(state);
  assert.equal(events.length, count, 'unchanged state does not produce synthetic activity');
  const primary = Object.assign(new Error('ownership pending'), { code: 'ERR_CACHE_PENDING', cacheOwnershipPending: true });
  owner.stopped({ ...state, shutdownSignal: 'ABORT' }, primary);
  assert.equal(events.at(-1).status, 'failed'); assert.equal(events.at(-1).ownershipPending, true);
}
console.log('Watch emits canonical idle/update/degraded/publication/teardown observations without readiness inference');
