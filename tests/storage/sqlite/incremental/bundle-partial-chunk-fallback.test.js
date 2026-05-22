import assert from 'node:assert/strict';

import {
  findFirstBundleEntry,
  readFirstBundleShard,
  runIncrementalSqliteAndGetOutput,
  setupBundlePartialFallbackFixture,
  writeBundleChunks,
  writeLargeMultiChunkSource
} from './bundle-partial-fallback-helper.js';

const { repoRoot, repoCacheRoot, manifest } = await setupBundlePartialFallbackFixture({
  name: 'bundle-partial-chunk-fallback',
  beforeBuild: ({ repoRoot }) => writeLargeMultiChunkSource(repoRoot)
});

const { targetEntry } = findFirstBundleEntry(manifest, ({ file }) => file === 'src/multi-chunk.js');
const { bundlePath, readResult } = await readFirstBundleShard(repoCacheRoot, targetEntry);
assert.ok(Array.isArray(readResult.bundle?.chunks) && readResult.bundle.chunks.length > 1, 'expected multi-chunk bundle before mutation');

const mutatedChunks = readResult.bundle.chunks.map((chunk, index) => (
  index === 0
    ? {
      ...chunk,
      embedding: null,
      embedding_u8: null
    }
    : chunk
));
await writeBundleChunks({
  bundlePath,
  targetEntry,
  readResult,
  chunks: mutatedChunks
});

const output = await runIncrementalSqliteAndGetOutput(repoRoot);
assert.match(output, /incremental bundle build failed for code: bundles missing embeddings; using artifacts\./i);
assert.match(output, /bundle embeddings code: .*partial 1.*missingChunks=1.*sample missing:/i);

console.log('sqlite incremental partial chunk fallback test passed');
