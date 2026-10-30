#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { persistIncrementalManifest } from '../../../../src/index/build/incremental/manifest-codec.js';
import { readIncrementalBundleSnapshot, writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { resolveBundleJsonChecksumPath } from '../../../../src/shared/bundle-io-paths.js';
import { refreshIncrementalBundlesWithEmbeddings } from '../../../../tools/build/embeddings/runner.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `bundle-coverage-receipt-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
try {
  const bundleDir = path.join(root, 'bundles');
  const manifestPath = path.join(root, 'manifest.json');
  const seed = async (file, shards, orderIndex) => {
    const entry = { hash: `source-${file}`, size: 12, mtimeMs: 1, orderIndex,
      dependencySignatures: { parser: 'fixture-v1' } };
    return { ...entry, ...await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
      bundles: shards.map(chunks => ({ ...entry, file, chunks })), format: 'json' }) };
  };
  const first = { chunkUid: 'a', file: 'a.js', start: 0, end: 4, embedding_u8: [11, 22] };
  const second = { chunkUid: 'b', file: 'b.md', start: 0, end: 4, embedding_u8: [33, 44] };
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {
    'a.js': await seed('a.js', [[first]], 0),
    'b.md': await seed('b.md', [[second]], 1),
    'empty.js': await seed('empty.js', [[]], 2)
  } };
  const chunksByFile = new Map([['a.js', [{ index: 0, chunk: first }]], ['b.md', [{ index: 1, chunk: second }]]]);
  const mergedVectors = [new Uint8Array([11, 22]), new Uint8Array([33, 44])];
  const input = { mode: 'extracted-prose', incremental: { manifest, bundleDir, manifestPath }, chunksByFile, mergedVectors,
    embeddingMode: 'fixture', embeddingIdentityKey: 'model-tokenizer-pooling-quantizer-v1',
    scheduleIo: operation => operation(), log: () => {}, warn: () => {}, parallelism: 2 };
  const initial = await refreshIncrementalBundlesWithEmbeddings(input);
  assert.equal(initial.completeCoverage, true);
  assert.equal(initial.work.bundleSnapshotsRead, 3);
  assert.equal(initial.work.chunksCompared, 2);
  assert.equal(initial.manifestWritten, true);
  const baseline = structuredClone(input.incremental.manifest);
  const baselineBytes = await fs.readFile(manifestPath);
  for (const entry of Object.values(baseline.files)) assert.equal(entry.embeddingCoverageReceipt.version, 1);

  const repeated = await refreshIncrementalBundlesWithEmbeddings(input);
  assert.equal(repeated.completeCoverage, true);
  assert.equal(repeated.work.skippedByProof, 3, 'empty and nonempty selected snapshots have individual proofs');
  assert.equal(repeated.work.bundleSnapshotsRead, 0);
  assert.equal(repeated.work.bundleSnapshotsDecoded, 0);
  assert.equal(repeated.work.chunksCompared, 0);
  assert.equal(repeated.manifestWritten, false);
  assert.deepEqual(await fs.readFile(manifestPath), baselineBytes, 'proof-only repetition leaves the manifest bytes untouched');

  const scenario = async (edit, overrides = {}) => {
    const selected = structuredClone(baseline);
    edit(selected);
    await persistIncrementalManifest(manifestPath, selected);
    const candidate = { ...input, ...overrides, incremental: { ...input.incremental, manifest: selected } };
    return { result: await refreshIncrementalBundlesWithEmbeddings(candidate), candidate };
  };
  const changed = await scenario(() => {}, { mergedVectors: [new Uint8Array([99, 22]), mergedVectors[1]] });
  assert.equal(changed.result.work.skippedByProof, 2, 'only the changed vector range requires bundle hydration');
  assert.equal(changed.result.work.invalidatedReasons['missing-or-changed-vector-range'], 1);
  assert.equal(changed.result.rewritten, 1);
  const changedBundle = await readIncrementalBundleSnapshot({ bundleDir, relKey: 'a.js', entry: changed.candidate.incremental.manifest.files['a.js'] });
  assert.deepEqual(Array.from(changedBundle.bundle.chunks[0].embedding_u8), [99, 22]);

  const reordered = new Map([['a.js', [{ index: 1, chunk: first }]], ['b.md', [{ index: 0, chunk: second }]]]);
  const remapped = await scenario(() => {}, { chunksByFile: reordered, mergedVectors: [mergedVectors[1], mergedVectors[0]] });
  assert.equal(remapped.result.work.skippedByProof, 0, 'ordinal mapping changes conservatively invalidate the global mapping binding');
  assert.equal(remapped.result.completeCoverage, true);
  assert.equal(remapped.result.rewritten, 0, 'remapping preserves the selected chunk vector values');

  const identity = await scenario(() => {}, { embeddingIdentityKey: 'model-tokenizer-pooling-quantizer-v2' });
  assert.equal(identity.result.work.skippedByProof, 0);
  assert.equal(identity.result.work.invalidatedReasons['identity-source-or-mapping'], 3);
  const missingMapping = await scenario(() => {}, { chunksByFile: new Map([['a.js', chunksByFile.get('a.js')]]) });
  assert.equal(missingMapping.result.completeCoverage, false, 'partial extracted-prose coverage never inherits complete coverage');
  assert.equal(missingMapping.result.skippedNoMappingChunks, 1);
  assert.equal(missingMapping.candidate.incremental.manifest.files['b.md'].embeddingCoverageReceipt, undefined);

  const sourceChanged = await scenario(value => { value.files['a.js'].hash = 'new-source'; });
  assert.equal(sourceChanged.result.skippedInvalidBundle, 1, 'an old snapshot cannot prove a newly selected source');
  assert.equal(sourceChanged.result.completeCoverage, false);
  const dependencies = await scenario(value => { value.files['a.js'].dependencySignatures.parser = 'fixture-v2'; });
  assert.equal(dependencies.result.skippedInvalidBundle, 1);
  const malformed = await scenario(value => { value.files['a.js'].embeddingCoverageReceipt.ranges = []; });
  assert.equal(malformed.result.work.invalidatedReasons['malformed-receipt'], 1);
  assert.equal(malformed.result.work.skippedByProof, 2);
  assert.equal(malformed.result.work.chunksCompared, 1);
  const removed = await scenario(value => { delete value.files['b.md']; }, { chunksByFile: new Map([['a.js', chunksByFile.get('a.js')]]) });
  assert.equal(removed.result.scanned, 2);
  assert.equal(removed.candidate.incremental.manifest.files['b.md'], undefined);

  const full = await scenario(value => {
    for (const entry of Object.values(value.files)) delete entry.embeddingCoverageReceipt;
  });
  assert.equal(full.result.completeCoverage, repeated.completeCoverage);
  assert.equal(full.result.rewritten, 0);
  assert.equal(full.result.covered, repeated.covered, 'proof and full-hydration paths agree on exact coverage');

  const checksumPath = resolveBundleJsonChecksumPath(path.join(bundleDir, baseline.files['a.js'].bundles[0]));
  await fs.writeFile(checksumPath, 'corrupt-checksum');
  const sidecar = await scenario(() => {});
  assert.equal(sidecar.result.work.invalidatedReasons['immutable-file-generation'], 1);
  assert.equal(sidecar.result.skippedInvalidBundle, 1, 'changed sidecars return to the authoritative checksum-aware reader');
  assert.equal(sidecar.result.completeCoverage, false);
  console.log('Bundle coverage receipts preserve individual mapping, source, vector and immutable-file authority; synthetic inputs only.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
