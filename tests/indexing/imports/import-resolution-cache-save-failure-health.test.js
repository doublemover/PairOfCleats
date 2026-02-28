#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-cache-save-failure-health');
const badCachePath = path.join(tempRoot, 'import-resolution-cache-as-directory');
const failOpenMarkerPath = path.join(tempRoot, 'import-resolution-cache.fail-open.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.mkdir(badCachePath, { recursive: true });

const logs = [];
const cacheStats = {
  health: Object.create(null)
};
const cache = {
  version: 6,
  generatedAt: null,
  packageFingerprint: null,
  fileSetFingerprint: null,
  cacheKey: null,
  files: {},
  lookup: null,
  diagnostics: null
};

const first = await saveImportResolutionCache({
  cache,
  cachePath: badCachePath,
  log: (line) => logs.push(String(line || '')),
  cacheStats,
  persistWarningThrottleMs: 60_000,
  failOpenMarkerPath,
  writeFailOpenMarker: true
});
assert.equal(first?.ok, false, 'expected save failure outcome when cache path is a directory');
assert.equal(cacheStats.cachePersistWriteFailures, 1, 'expected persist failure counter');
assert.equal(cacheStats.health?.importCachePersistFailures, 1, 'expected persist health counter');
assert.equal(cacheStats.cachePersistFailOpenMarkerWrites, 1, 'expected fail-open marker write counter');
assert.equal(logs.length, 1, 'expected first persist failure to log immediately');
assert.equal(
  logs[0].includes('Failed to persist import resolution cache'),
  true,
  'expected explicit import cache persist failure warning'
);
const markerPayload = JSON.parse(await fs.readFile(failOpenMarkerPath, 'utf8'));
assert.equal(markerPayload?.marker, 'import-resolution-cache-persist-fail-open');
assert.equal(markerPayload?.cachePath, badCachePath);

const second = await saveImportResolutionCache({
  cache,
  cachePath: badCachePath,
  log: (line) => logs.push(String(line || '')),
  cacheStats,
  persistWarningThrottleMs: 60_000,
  failOpenMarkerPath,
  writeFailOpenMarker: true
});
assert.equal(second?.ok, false, 'expected repeated persist failure outcome');
assert.equal(cacheStats.cachePersistWriteFailures, 2, 'expected persist failure counter to increment');
assert.ok(
  Number(cacheStats.cachePersistWriteWarningsSuppressed || 0) >= 1,
  'expected throttled warning suppression counter to increment'
);
assert.equal(logs.length, 1, 'expected repeated failure warning to be throttled');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('import resolution cache save failure health test passed');
