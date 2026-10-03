import assert from 'node:assert/strict';

import {
  runIncrementalSqliteAndGetOutput,
  setupBundlePartialFallbackFixture,
  writeManifest
} from './bundle-partial-fallback-helper.js';

const { repoRoot, manifestPath, manifest } = await setupBundlePartialFallbackFixture({
  name: 'bundle-coverage-metadata-fallback'
});

assert.equal(manifest.bundleEmbeddings, true, 'expected stage3 manifest to advertise bundle embeddings');
assert.equal(manifest.bundleEmbeddingCoverageComplete, true, 'expected stage3 manifest to start complete');

manifest.bundleEmbeddings = true;
manifest.bundleEmbeddingCoverageComplete = true;
manifest.bundleEmbeddingCoverageEligible = 1;
manifest.bundleEmbeddingCoverageCovered = 1;
manifest.bundleEmbeddingCoverageMissingFiles = 0;
manifest.bundleEmbeddingCoverageMissingChunks = 1;
writeManifest(manifestPath, manifest);

const output = await runIncrementalSqliteAndGetOutput(repoRoot);
assert.match(
  output,
  /incremental bundles skipped for code: bundle embedding coverage inconsistent .*missingChunks=1.*; using artifacts\./i
);
assert.match(output, /bundle manifest code: .*bundleEmbeddingCoverageMissingChunks=1/i);

console.log('sqlite incremental bundle coverage metadata fallback test passed');
