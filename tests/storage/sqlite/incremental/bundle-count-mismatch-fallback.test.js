import assert from 'node:assert/strict';

import {
  findFirstBundleEntry,
  readFirstBundleShard,
  runIncrementalSqliteAndGetOutput,
  setupBundlePartialFallbackFixture,
  writeBundleChunks
} from './bundle-partial-fallback-helper.js';

const { repoRoot, repoCacheRoot, manifest } = await setupBundlePartialFallbackFixture({
  name: 'bundle-count-mismatch-fallback'
});

const { targetEntry } = findFirstBundleEntry(manifest);
const { bundlePath, readResult } = await readFirstBundleShard(repoCacheRoot, targetEntry);
assert.ok(Array.isArray(readResult.bundle?.chunks) && readResult.bundle.chunks.length > 0, 'expected bundle chunks before mutation');

const mutatedChunks = readResult.bundle.chunks.slice(1);
await writeBundleChunks({
  bundlePath,
  targetEntry,
  readResult,
  chunks: mutatedChunks
});

const output = await runIncrementalSqliteAndGetOutput(repoRoot);
assert.match(output, /incremental bundle build failed for code: bundle row count mismatch \(\d+ !== \d+\); using artifacts\./i);

console.log('sqlite incremental bundle count mismatch fallback test passed');
