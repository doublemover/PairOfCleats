#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshIncrementalBundlesWithEmbeddings } from '../../../../tools/build/embeddings/runner.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `bundle-refresh-coverage-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
try {
  const bundleDir = path.join(root, 'bundles');
  await fs.mkdir(bundleDir);
  await fs.writeFile(path.join(bundleDir, 'empty.json'), JSON.stringify({ chunks: [] }));
  await fs.writeFile(path.join(bundleDir, 'valid.json'), JSON.stringify({ chunks: [{ chunkUid: 'fixture-vector', embedding_u8: [1, 2] }] }));
  const manifest = { bundleFormat: 'json', files: {
    'empty.md': { bundle: 'empty.json', orderIndex: 0 },
    'missing.md': { bundle: 'missing.json', orderIndex: 1 },
    'valid.md': { bundle: 'valid.json', orderIndex: 2 }
  } };
  const manifestPath = path.join(root, 'manifest.json');
  const refreshed = await refreshIncrementalBundlesWithEmbeddings({ mode: 'code', repoCacheRoot: root,
    incremental: { manifest, bundleDir, manifestPath }, chunksByFile: new Map([['valid.md', [{ index: 0,
      chunk: { chunkUid: 'fixture-vector' } }]]]), mergedVectors: [new Uint8Array([1, 2])],
    embeddingMode: 'stub', embeddingIdentityKey: 'fixture', lowYieldBailout: { enabled: false },
    scheduleIo: (operation) => operation(), log: () => {}, warn: () => {} });
  assert.equal(refreshed.completeCoverage, false);
  assert.equal(refreshed.skippedInvalidBundle, 1);
  assert.equal(refreshed.eligible, 1);
  assert.equal(refreshed.covered, 1, 'a valid covered bundle does not erase the invalid sibling');
  const stored = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(stored.bundleEmbeddingCoverageComplete, false);
  assert.equal(stored.bundleEmbeddingCoverageInvalidBundles, 1);
  assert.equal(stored.bundleEmbeddingCoverageProcessedFiles, 3);

  const bailoutManifest = { bundleFormat: 'json', files: Object.fromEntries(
    ['generated/a.js', 'generated/b.js', 'generated/c.js'].map((file, orderIndex) => [file, { bundle: 'empty.json', orderIndex }])
  ) };
  const bailoutPath = path.join(root, 'bailout-manifest.json');
  const bailoutInput = { mode: 'extracted-prose', repoCacheRoot: root,
    incremental: { manifest: bailoutManifest, bundleDir, manifestPath: bailoutPath },
    chunksByFile: new Map(), mergedVectors: [], embeddingMode: 'stub', embeddingIdentityKey: 'fixture',
    scheduleIo: (operation) => operation(), log: () => {}, warn: () => {} };
  const bailed = await refreshIncrementalBundlesWithEmbeddings({ ...bailoutInput,
    lowYieldBailout: { enabled: true, warmupSampleSize: 1, warmupWindowMultiplier: 1 } });
  assert.ok(bailed.lowYieldBailoutSkipped > 0, 'the actual refresh owner must stop after a zero-yield warmup');
  assert.equal(bailed.eligible, 0);
  assert.equal(bailed.covered, 0);
  assert.equal(bailed.completeCoverage, false, '0/0 coverage cannot certify unexamined bundles');
  const storedBailout = JSON.parse(await fs.readFile(bailoutPath, 'utf8'));
  assert.equal(storedBailout.bundleEmbeddingCoverageComplete, false);
  assert.equal(storedBailout.bundleEmbeddingCoverageUnexaminedFiles, bailed.lowYieldBailoutSkipped);
  assert.equal(storedBailout.bundleEmbeddingCoverageProcessedFiles + storedBailout.bundleEmbeddingCoverageUnexaminedFiles, 3);

  const fullyExamined = await refreshIncrementalBundlesWithEmbeddings({ ...bailoutInput,
    lowYieldBailout: { enabled: false } });
  assert.equal(fullyExamined.completeCoverage, true, 'examined valid empty bundles retain their existing complete contract');
  assert.equal(fullyExamined.coverage.unexaminedFiles, 0);
  console.log('Actual bundle refresh owner accounts for missing siblings and unexamined bailout entries; synthetic payloads only.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
