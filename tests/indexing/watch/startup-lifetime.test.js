import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getEventListeners } from 'node:events';
import { watchIndex } from '../../../src/index/build/watch.js';
import { createTempWatchRepo, createWatchRuntime, createWatchDeps } from './helpers.js';

const contains = (error, expected, seen = new Set()) => {
  if (error === expected) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return [error.cause, ...(error.errors || [])].some(child => contains(child, expected, seen));
};
const { repoRoot, tempRoot, files } = await createTempWatchRepo({ prefix: 'poc-watch-startup-',
  files: { source: { rel: 'src/a.js', content: 'export const value = 1;' } } });
try {
  for (const variant of ['discovery', 'backend', 'ready', 'state', 'close', 'close-getter', 'abort-discovery', 'abort-backend', 'captured-close']) {
    const controller = new AbortController(), primary = Object.freeze(new Error(`controlled ${variant}`));
    const closeFailure = Object.freeze(new Error('controlled close refusal'));
    const runtime = await createWatchRuntime({ repoRoot });
    const { deps } = createWatchDeps({ entries: [files.source], buildIndexForMode: async () => {} });
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    const beforeAbort = getEventListeners(controller.signal, 'abort').length;
    let acquired = 0, closed = 0, replaced = 0, stopped = 0, states = 0, onEvent;
    const watcher = { close: async () => { closed++; if (variant === 'close') throw closeFailure; } };
    deps.createWatchProgress = () => ({ observe() {}, monitoring() {}, degraded() {}, stopped() { stopped++; } });
    deps.discoverFilesForModes = async () => {
      if (variant === 'discovery') throw primary;
      if (variant === 'abort-discovery') controller.abort();
      return { code: [files.source] };
    };
    deps.startWatcher = async input => {
      onEvent = input.onEvent;
      if (variant === 'backend') throw primary;
      acquired++;
      if (variant === 'abort-backend') controller.abort();
      if (variant === 'close-getter') Object.defineProperty(watcher, 'close', { get() { throw primary; } });
      return watcher;
    };
    const run = watchIndex({ runtime, modes: ['code'], pollMs: 0, debounceMs: 10,
      abortSignal: controller.signal, handleSignals: true, deps,
      onStateChange: () => { states++; if (variant === 'state') throw primary; },
      onReady: () => {
        if (['ready', 'close'].includes(variant)) throw primary;
        if (variant === 'captured-close') watcher.close = async () => { replaced++; };
        controller.abort();
      } });
    if (['discovery', 'backend', 'ready', 'state', 'close', 'close-getter'].includes(variant)) {
      await assert.rejects(run, error => {
        assert.ok(contains(error, primary));
        if (['close', 'close-getter'].includes(variant)) assert.equal(error.cacheOwnershipPending, true);
        if (variant === 'close') assert.ok(contains(error, closeFailure));
        return true;
      });
    } else await run;
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), before);
    assert.equal(getEventListeners(controller.signal, 'abort').length, beforeAbort);
    assert.equal(acquired, ['discovery', 'backend', 'abort-discovery'].includes(variant) ? 0 : 1);
    assert.equal(closed, acquired && variant !== 'close-getter' ? 1 : 0);
    assert.equal(replaced, 0, 'capture and invoke the actual acquired close owner');
    assert.equal(stopped, 1, 'terminal observation survives startup and cleanup errors');
    const settledStates = states;
    onEvent?.({ type: 'change', absPath: files.source.abs });
    assert.equal(states, settledStates, 'failed invocation rejects late backend events');
  }
} finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
console.log('watch startup lifetime passed');
