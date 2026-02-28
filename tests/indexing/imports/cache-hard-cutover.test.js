#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadImportResolutionCache,
  saveImportResolutionCache
} from '../../../src/index/build/import-resolution-cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'imports-cache-hard-cutover');
const incrementalDir = path.join(tempRoot, 'incremental');
const cachePath = path.join(incrementalDir, 'import-resolution-cache.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(incrementalDir, { recursive: true });

const logs = [];
const log = (message) => logs.push(String(message || ''));

await fs.writeFile(cachePath, JSON.stringify({ version: 4 }, null, 2));
await assert.rejects(
  () => loadImportResolutionCache({
    incrementalState: { incrementalDir },
    log
  }),
  (error) => {
    assert.equal(error?.code, 'ERR_IMPORT_RESOLUTION_CACHE_INCOMPATIBLE');
    assert.equal(error?.cachePath, cachePath);
    assert.equal(error?.expectedVersion > 0, true);
    return true;
  },
  'expected incompatible cache version to fail closed'
);
assert.equal(
  logs.some((entry) => entry.includes('incompatible import resolution cache version')),
  true,
  'expected an explicit remediation log for incompatible cache version'
);

await fs.writeFile(cachePath, '{');
const malformedLoad = await loadImportResolutionCache({
  incrementalState: { incrementalDir },
  log
});
assert.equal(malformedLoad.cache?.version > 0, true, 'malformed cache should fall back to empty cache');
assert.equal(
  logs.some((entry) => entry.includes('Failed to read import resolution cache')),
  true,
  'expected malformed JSON cache read failure log'
);

await saveImportResolutionCache({
  cache: malformedLoad.cache,
  cachePath: malformedLoad.cachePath
});
const reloaded = await loadImportResolutionCache({
  incrementalState: { incrementalDir },
  log
});
assert.deepEqual(reloaded.cache?.files, {}, 'expected persisted cache to round-trip');

console.log('import-resolution cache hard cutover test passed');
