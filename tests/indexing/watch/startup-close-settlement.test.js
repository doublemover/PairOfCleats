import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getEventListeners } from 'node:events';
import { watchIndex } from '../../../src/index/build/watch.js';
import { createTempWatchRepo, createWatchRuntime, createWatchDeps } from './helpers.js';
const repo = await createTempWatchRepo({ prefix: 'poc-watch-close-settlement-', files: { source: { rel: 'source.js', content: 'export const value = 1;' } } });
const controller = new AbortController(), primary = Object.freeze(new Error('readiness observer failed'));
const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), abortCount = getEventListeners(controller.signal, 'abort').length;
let release, entered, onEvent, closed = 0, settled = false, states = 0, builds = 0;
const closing = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
const runtime = await createWatchRuntime({ repoRoot: repo.repoRoot });
const { deps } = createWatchDeps({ entries: [repo.files.source], buildIndexForMode: async () => { builds++; } });
deps.startWatcher = async input => { onEvent = input.onEvent; return { close: async () => { closed++; entered(); await barrier; } }; };
const pending = watchIndex({ runtime, modes: ['code'], pollMs: 0, debounceMs: 10, abortSignal: controller.signal, handleSignals: true, deps,
  onStateChange() { states++; }, onReady() { throw primary; } });
const outcome = pending.then(() => { settled = true; return null; }, error => { settled = true; return error; });
try {
  await closing; await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), before);
  assert.equal(getEventListeners(controller.signal, 'abort').length, abortCount);
  const count = states; onEvent({ type: 'change', absPath: repo.files.source.abs });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(builds, 0); assert.equal(states, count);
  release(); assert.equal(await outcome, primary); assert.equal(closed, 1);
} finally { release(); await outcome; await fs.rm(repo.tempRoot, { recursive: true, force: true }); }
console.log('Readiness failure retains actual captured backend close before terminal rejection and cannot emit late work.');
