#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshIncrementalBundlesWithEmbeddings } from '../../../../tools/build/embeddings/runner.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { readBundleFile } from '../../../../src/shared/bundle-io.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';

const root = resolveTestCachePath(process.cwd(), `bundle-refresh-coverage-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
try {
  const bundleDir = path.join(root, 'bundles');
  await fs.mkdir(bundleDir);
  const seed = async (file, shards) => {
    const entry = { hash: 'source', size: 1, mtimeMs: 1, dependencySignatures: { parse: 'fixture' } };
    return { ...entry, ...await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
      bundles: shards.map(chunks => ({ ...entry, file, chunks })), format: 'json' }) };
  };
  const manifest = { bundleFormat: 'json', files: {
    'empty.md': { ...await seed('empty.md', [[]]), orderIndex: 0 },
    'missing.md': { bundles: ['missing.json'], orderIndex: 1 },
    'valid.md': { ...await seed('valid.md', [[{ chunkUid: 'fixture-vector', file: 'valid.md', embedding_u8: [1, 2] }]]), orderIndex: 2 }
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

  const emptyEntries = [];
  for (let orderIndex = 0; orderIndex < 48; orderIndex++) {
    const file = `generated/empty-${orderIndex}.js`;
    emptyEntries.push([file, { ...await seed(file, [[]]), orderIndex }]);
  }
  const lateEntry = await seed('generated/late.js', [[{ chunkUid: 'late-a' }], [{ chunkUid: 'late-b' }]]);
  const bailoutManifest = { bundleFormat: 'json', files: Object.fromEntries([
    ...emptyEntries, ['generated/late.js', { ...lateEntry, orderIndex: 48 }]
  ]) };
  const bailoutPath = path.join(root, 'bailout-manifest.json');
  const bailoutInput = { mode: 'extracted-prose', repoCacheRoot: root,
    incremental: { manifest: bailoutManifest, bundleDir, manifestPath: bailoutPath },
    chunksByFile: new Map([['generated/late.js', [{ index: 0, chunk: { chunkUid: 'late-a' } },
      { index: 1, chunk: { chunkUid: 'late-b' } }]]]), mergedVectors: [new Uint8Array([11, 22]), new Uint8Array([33, 44])],
    embeddingMode: 'stub', embeddingIdentityKey: 'fixture',
    scheduleIo: (operation) => operation(), log: () => {}, warn: () => {} };
  const bailed = await refreshIncrementalBundlesWithEmbeddings({ ...bailoutInput,
    lowYieldBailout: { enabled: true, warmupSampleSize: 48, warmupWindowMultiplier: 1 }, parallelism: 2 });
  assert.equal(bailed.lowYieldBailoutSkipped, 0, 'synchronizing existing vectors never applies extraction admission');
  assert.equal(bailed.lowYieldBailout, null, 'bundle synchronization is not source-content recall loss');
  assert.equal(bailed.eligible, 1);
  assert.equal(bailed.covered, 1);
  assert.equal(bailed.rewritten, 1);
  assert.equal(bailed.completeCoverage, true);
  const storedBailout = JSON.parse(await fs.readFile(bailoutPath, 'utf8'));
  assert.equal(storedBailout.bundleEmbeddingCoverageComplete, true);
  assert.equal(storedBailout.bundleEmbeddingCoverageUnexaminedFiles, 0);
  assert.equal(storedBailout.bundleEmbeddingCoverageProcessedFiles, 49);
  const lateChunks = [];
  for (const name of bailoutInput.incremental.manifest.files['generated/late.js'].bundles) {
    const read = await readBundleFile(path.join(bundleDir, name), { format: 'json' });
    assert.equal(read.ok, true, 'refreshed shards pass the existing checksum-aware reader');
    lateChunks.push(...read.bundle.chunks);
  }
  assert.deepEqual(lateChunks.map((chunk) => [chunk.chunkUid, Array.from(chunk.embedding_u8)]),
    [['late-a', [11, 22]], ['late-b', [33, 44]]], 'late bundle rows agree with the produced artifact chunk/vector ledger');

  const fullyExamined = await refreshIncrementalBundlesWithEmbeddings({ ...bailoutInput,
    lowYieldBailout: { enabled: false } });
  assert.equal(fullyExamined.completeCoverage, true);
  assert.equal(fullyExamined.rewritten, 0, 'a second synchronization reuses unchanged vectors');
  assert.equal(fullyExamined.coverage.unexaminedFiles, 0);
  const retained = structuredClone(bailoutInput.incremental.manifest);
  const priorBytes = await fs.readFile(bailoutPath);
  const oversized = { ...bailoutInput, incremental: { ...bailoutInput.incremental,
    manifest: { ...retained, largeMetadata: 'x'.repeat(8 * 1024 * 1024) } } };
  const refsBefore = structuredClone(oversized.incremental.manifest.files);
  await assert.rejects(refreshIncrementalBundlesWithEmbeddings(oversized), { code: 'ERR_INCREMENTAL_MANIFEST_CAPACITY' });
  assert.deepEqual(await fs.readFile(bailoutPath), priorBytes, 'failed publication retains the prior readable manifest');
  assert.deepEqual(oversized.incremental.manifest.files, refsBefore, 'failed publication preserves selected in-memory references');
  const formatGate = JSON.parse(await fs.readFile(bailoutPath, 'utf8'));
  assert.equal(formatGate.version, 6);
  console.log('Actual refresh owner synchronizes late sharded vectors after empty warmup and rejects invalid siblings; synthetic payloads only.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
