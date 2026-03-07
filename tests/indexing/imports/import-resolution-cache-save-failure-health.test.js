#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-cache-save-failure-health');
const badCachePath = path.join(tempRoot, 'import-resolution-cache-as-directory');
const goodCachePath = path.join(tempRoot, 'import-resolution-cache.json');
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
assert.equal(first?.warningEmitted, true, 'expected first failure warning to be emitted');
assert.equal(first?.warningSuppressed, false, 'expected first failure warning to avoid suppression');
assert.equal(first?.warningSuppressedCount, 0, 'expected no suppressed warning count on first failure');
assert.equal(first?.configuredFailOpenMarkerPath, failOpenMarkerPath, 'expected fail-open marker path to be plumbed');
assert.equal(first?.failOpenMarkerWritten, true, 'expected fail-open marker to be written on failure');
assert.equal(cacheStats.cachePersistWriteFailures, 1, 'expected persist failure counter');
assert.equal(cacheStats.health?.importCachePersistFailures, 1, 'expected persist health counter');
assert.equal(cacheStats.cachePersistFailOpenMarkerWrites, 1, 'expected fail-open marker write counter');
assert.equal(cacheStats.cachePersistWarningLastEmitted, true, 'expected cache stats to track warning emission');
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
assert.equal(second?.warningEmitted, false, 'expected repeated warning to remain throttled');
assert.equal(second?.warningSuppressed, true, 'expected repeated warning suppression');
assert.equal(second?.warningSuppressedCount, 1, 'expected suppression count to reflect repeated failure');
assert.equal(cacheStats.cachePersistWriteFailures, 2, 'expected persist failure counter to increment');
assert.ok(
  Number(cacheStats.cachePersistWriteWarningsSuppressed || 0) >= 1,
  'expected throttled warning suppression counter to increment'
);
assert.ok(
  Number(cacheStats.health?.importCachePersistWarningSuppressions || 0) >= 1,
  'expected warning suppression health counter to increment'
);
assert.equal(logs.length, 1, 'expected repeated failure warning to be throttled');

const recovered = await saveImportResolutionCache({
  cache,
  cachePath: goodCachePath,
  log: (line) => logs.push(String(line || '')),
  cacheStats,
  persistWarningThrottleMs: 60_000,
  failOpenMarkerPath,
  writeFailOpenMarker: true
});
assert.equal(recovered?.ok, true, 'expected save to recover when cache path is writable');
assert.equal(recovered?.configuredFailOpenMarkerPath, failOpenMarkerPath);
assert.equal(recovered?.failOpenMarkerCleared, true, 'expected fail-open marker cleanup on recovery');
assert.equal(cacheStats.cachePersistLastWriteOk, true, 'expected cache stats to track recovered persist state');
const markerExistsAfterRecovery = await fs.access(failOpenMarkerPath)
  .then(() => true)
  .catch(() => false);
assert.equal(markerExistsAfterRecovery, false, 'expected fail-open marker to be removed after successful persist');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('import resolution cache save failure health test passed');
