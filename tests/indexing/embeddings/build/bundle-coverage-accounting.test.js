#!/usr/bin/env node
import assert from 'node:assert/strict';
import { summarizeBundleEmbeddingCoverage, stampBundleEmbeddingCoverage } from '../../../../tools/build/embeddings/runner/bundle-coverage.js';

const summarize = (changes) => summarizeBundleEmbeddingCoverage({ totalFiles: 5, processedFiles: 5,
  eligibleFiles: 3, coveredFiles: 3, missingChunks: 0, invalidBundles: 0, ...changes });
const bailed = summarize({ totalFiles: 60, processedFiles: 5, eligibleFiles: 0, coveredFiles: 0 });
assert.equal(bailed.complete, false, 'zero observed targets after warmup does not cover unexamined files');
assert.equal(bailed.unexaminedFiles, 55);
assert.equal(bailed.missingFiles, 0, 'known missing count remains distinct from unknown coverage');
const manifest = { bundleEmbeddings: true, bundleEmbeddingCoverageComplete: true };
stampBundleEmbeddingCoverage(manifest, bailed);
assert.equal(manifest.bundleEmbeddings, false);
assert.equal(manifest.bundleEmbeddingCoverageComplete, false);
assert.equal(manifest.bundleEmbeddingCoverageUnexaminedFiles, 55);
assert.equal(manifest.bundleEmbeddingCoverageEligible, 0);
assert.equal(manifest.bundleEmbeddingCoverageCovered, 0);
assert.equal(summarize({ invalidBundles: 1 }).complete, false, 'covered valid files cannot hide an invalid bundle');
assert.equal(summarize({ coveredFiles: 2 }).complete, false);
assert.equal(summarize({ missingChunks: 1 }).complete, false);
assert.equal(summarize({ totalFiles: 5, processedFiles: 4 }).complete, false);
assert.equal(summarize({ eligibleFiles: 0, coveredFiles: 0 }).complete, true, 'examined valid empty bundles are legitimately empty');
assert.equal(summarize({ totalFiles: 0, processedFiles: 0, eligibleFiles: 0, coveredFiles: 0 }).complete, false,
  'an unattempted manifest is not promoted as complete');
for (const changes of [{ processedFiles: 6 }, { coveredFiles: 4 }, { missingChunks: null }, { invalidBundles: -1 }]) {
  assert.equal(summarize(changes).complete, false, 'invalid accounting never promotes metadata');
}
stampBundleEmbeddingCoverage(manifest, summarize({}));
assert.equal(manifest.bundleEmbeddingCoverageComplete, true);
assert.equal(manifest.bundleEmbeddingCoverageUnexaminedFiles, 0);
console.log('Bailout/unexamined, invalid, missing-vector, valid-empty and complete bundle coverage accounting pass.');
