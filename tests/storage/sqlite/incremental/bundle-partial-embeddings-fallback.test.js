import assert from 'node:assert/strict';

import {
  findFirstBundleEntry,
  readFirstBundleShard,
  readManifest,
  runIncrementalSqliteAndGetOutput,
  setupBundlePartialFallbackFixture,
  writeBundleChunks,
  writeManifest
} from './bundle-partial-fallback-helper.js';

const { repoRoot, repoCacheRoot, manifestPath, manifest } = await setupBundlePartialFallbackFixture({
  name: 'bundle-partial-embeddings-fallback'
});

const { targetEntry } = findFirstBundleEntry(manifest);
const { bundlePath, readResult } = await readFirstBundleShard(repoCacheRoot, targetEntry);

const mutatedChunks = (readResult.bundle.chunks || []).map((chunk) => ({
  ...chunk,
  embedding: null,
  embedding_u8: null
}));
await writeBundleChunks({
  bundlePath,
  targetEntry,
  readResult,
  chunks: mutatedChunks
});

manifest.bundleEmbeddings = false;
manifest.bundleEmbeddingCoverageComplete = false;
manifest.bundleEmbeddingCoverageEligible = 1;
manifest.bundleEmbeddingCoverageCovered = 0;
manifest.bundleEmbeddingCoverageMissingFiles = 1;
manifest.bundleEmbeddingCoverageMissingChunks = mutatedChunks.length;
writeManifest(manifestPath, manifest);

const output = await runIncrementalSqliteAndGetOutput(repoRoot);
assert.match(output, /incremental bundles skipped for code: bundles omit embeddings .*coverage incomplete .*; using artifacts\./i);
assert.match(output, /bundle manifest code: .*bundleEmbeddingCoverageMissingChunks=\d+/i);

const manifestAfter = readManifest(manifestPath);
assert.equal(manifestAfter.bundleEmbeddings, false, 'expected partial coverage to fail closed in manifest');
assert.equal(manifestAfter.bundleEmbeddingCoverageComplete, false, 'expected manifest to record incomplete embedding coverage');
assert.equal(manifestAfter.bundleEmbeddingCoverageMissingFiles, 1, 'expected manifest to record missing file coverage');
assert.equal(
  manifestAfter.bundleEmbeddingCoverageMissingChunks,
  mutatedChunks.length,
  'expected manifest to record missing chunk coverage'
);

console.log('sqlite incremental partial bundle embeddings fallback test passed');
