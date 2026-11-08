#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { resolveWatcherBackend } from '../../../src/index/build/watch.js';

const runtime = { userConfig: {}, argv: {} };
applyTestEnv({ extraEnv: { PAIROFCLEATS_WATCHER_BACKEND: null } });
const requested = [], optionalDepsUrl = new URL('../../../src/shared/optional-deps.js', import.meta.url).href;
const watcherModules = ['chokidar', '@parcel/watcher'];
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === optionalDepsUrl) {
    requested.push(specifier);
    if (!watcherModules.includes(specifier)) throw new Error(`Unrelated capability activated by watcher selection: ${specifier}`);
  }
  return next(specifier, context);
} });
try {
  resolveWatcherBackend({ runtime, pollMs: 0 });
  assert.deepEqual(requested, watcherModules, 'watch startup must activate only its actual watcher capabilities');
  resolveWatcherBackend({ runtime, pollMs: 0 });
  assert.deepEqual(requested, watcherModules, 'repeated selection must reuse those probes');
} finally { hook.deregister(); }
const caps = getCapabilities({ refresh: true });
const { getWatcherCapabilities } = await import('../../../src/shared/capabilities.js');
assert.equal(getWatcherCapabilities(), caps.watcher, 'explicit complete reporting and watcher selection share the same refreshed evidence');
const cachedWatcher = getWatcherCapabilities();
assert.equal(getWatcherCapabilities(), cachedWatcher, 'watcher evidence is cached independently of module-loader caches');
const refreshedWatcher = getWatcherCapabilities({ refresh: true });
assert.notEqual(refreshedWatcher, cachedWatcher, 'explicit refresh must replace the watcher snapshot');
assert.deepEqual(refreshedWatcher, cachedWatcher, 'refresh preserves actual installed availability');

process.env.PAIROFCLEATS_WATCHER_BACKEND = 'chokidar';
const forcedChokidar = resolveWatcherBackend({ runtime, pollMs: 0 });
assert.equal(forcedChokidar.resolved, 'chokidar', 'forced chokidar should resolve to chokidar');

process.env.PAIROFCLEATS_WATCHER_BACKEND = 'parcel';
const forcedParcel = resolveWatcherBackend({ runtime, pollMs: 0 });
if (caps.watcher.parcel) {
  assert.equal(forcedParcel.resolved, 'parcel', 'parcel should resolve when available');
} else {
  assert.equal(forcedParcel.resolved, 'chokidar', 'parcel should fall back when unavailable');
  assert.ok(forcedParcel.warning, 'fallback should include warning');
}

const pollFallback = resolveWatcherBackend({ runtime, pollMs: 500 });
assert.equal(pollFallback.resolved, 'chokidar', 'polling forces chokidar');

delete process.env.PAIROFCLEATS_WATCHER_BACKEND;

console.log('watch backend selection tests passed');
