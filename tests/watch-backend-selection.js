#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getCapabilities } from '../src/shared/capabilities.js';
import { resolveWatcherBackend } from '../src/index/build/watch.js';

const runtime = { userConfig: {}, argv: {} };
const caps = getCapabilities({ refresh: true });

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
