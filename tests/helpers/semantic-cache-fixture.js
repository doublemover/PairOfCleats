import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { createSyntaxPartitionId, createAnalysisPartitionId, semanticHash } from '../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../src/index/semantic/file-ref.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { createSemanticCacheDependencySignatures } from '../../src/index/build/incremental/semantic-cache-dependencies.js';
import { writeIncrementalBundle } from '../../src/index/build/incremental/writeback.js';
import { normalizeSemanticConfig } from '../../src/index/semantic/config.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { semanticBatch, semanticNode } from './semantic-recovery.js';
import { applyTestEnv } from './test-env.js';

export const createSemanticCacheFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-cache-'));
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const repoRoot = path.join(root, 'repo');
  const buildRoot = path.join(root, 'build');
  const bundleDir = path.join(root, 'bundles');
  await fs.mkdir(repoRoot); await fs.mkdir(bundleDir);
  const generation = { baseBuildId: 'fixture-build', semanticRevision: 0 };
  const storage = { generation, relativePath: 'index-code/semantic' };
  const policy = normalizeSemanticConfig({ enabled: true });
  const dependencySignatures = { parse: 'parse-v1', lexical: 'lexical-v1', enrichment: 'analysis-v1',
    embeddings: 'none', artifacts: 'artifact-v1' };
  const dependencies = createSemanticCacheDependencySignatures({ dependencySignatures, policy, root: repoRoot });
  const account = createSemanticDiskAccount(256 * 1024 * 1024);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, version: 5,
    dependencySignatures, files: {} };
  const createFile = async ({ file = 'input.js', text = 'f(1);', zeroChunks = false,
    nodeCount = 1, extraRows = [], analysisReason = null,
    producerHash = 'a'.repeat(64), chunks: suppliedChunks = null } = {}) => {
    const bytes = Buffer.from(text);
    const source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: repoRoot, path: file, language: 'javascript' }).manifest;
    await fs.mkdir(path.dirname(path.join(repoRoot, file)), { recursive: true });
    await fs.writeFile(path.join(repoRoot, file), bytes);
    const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
      parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' },
      structuralPolicy: { structure: 'complete' } });
    const coverage = [{ scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax', state: 'complete',
      reason: null, observedCount: nodeCount, completedCount: nodeCount, frontierRef: null }];
    const rows = [...Array.from({ length: nodeCount }, (_, id) => semanticNode(id, source.textLength)),
      ...coverage.map(row => ({ family: 'coverage', row })),
      ...(typeof extraRows === 'function' ? extraRows(source) : extraRows)];
    const sink = await createSemanticPartitionSink({ stagingRoot: path.join(buildRoot, storage.relativePath),
      source, sourceBytes: bytes, partitionId, producerHash, policyHash: 'b'.repeat(64), diskAccount: account });
    await sink.appendBatch(semanticBatch(partitionId, rows));
    const partition = await sink.finalizeSource();
    const partitions = [partition];
    if (analysisReason) {
      const row = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'bindings', state: 'unsupported',
        reason: analysisReason, observedCount: null, completedCount: 0, frontierRef: null };
      const analysisId = createAnalysisPartitionId({ pass: { name: 'fixture-analysis', version: '1' },
        inputPartitionHashes: [partition.canonicalHash], compilerContext: null, dependencySummaryHashes: [],
        analysisPolicy: { reason: analysisReason } });
      const analysis = await createSemanticPartitionSink({ stagingRoot: path.join(buildRoot, storage.relativePath),
        source, sourceBytes: bytes, partitionId: analysisId, producerHash: 'c'.repeat(64),
        policyHash: semanticHash('fixture-policy', { analysisReason }), diskAccount: account });
      await analysis.appendBatch(semanticBatch(analysisId, [{ family: 'coverage', row }]));
      partitions.push(await analysis.finalizeSource());
      coverage.push(row);
    }
    const factsRef = createSemanticFactsRef({ source, syntaxPartitionId: partitionId, partitions, storage, coverage });
    const chunks = suppliedChunks || (zeroChunks ? [] : [{ file, start: 0, end: text.length,
      kind: 'code', name: 'input', tokens: ['fixture'], text }]);
    const entry = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: file,
      fileStat: { mtimeMs: 1234567.25, size: bytes.length }, fileHash: 'hash-' + file,
      fileChunks: chunks, fileRelations: null, dependencySignatures, semanticFactsRef: factsRef,
      semanticContext: { buildRoot, diskAccount: account, dependencySignatures: dependencies } });
    if (!entry) throw new Error('Fixture bundle write failed.');
    manifest.files[file] = entry;
    return { file, bytes, source, factsRef, partition, entry, chunks };
  };
  return { root, repoRoot, buildRoot, bundleDir, generation, storage, policy, dependencySignatures,
    dependencies, account, manifest, createFile, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
};
