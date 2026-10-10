import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { createSyntaxPartitionId, canonicalSemanticJson } from '../../src/index/semantic/identity.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { applyTestEnv } from './test-env.js';

export const semanticBatch = (partitionId, rows, sequence = 0) => ({
  partitionId, rows, sequence,
  byteCount: rows.reduce((n, entry) => n + Buffer.byteLength(canonicalSemanticJson(entry)) + 1, 0)
});
export const semanticNode = (id, length) => ({
  family: 'node', row: { id, kind: 'expression', span: [0, length], scope: null,
    data: { astKind: 'Identifier', operation: null, invocationKind: null,
      syntacticArgumentCount: null, flags: [] } }
});
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
export const createRecoveryFixture = async (text = 'f(1);') => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-recovery-'));
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const bytes = Buffer.from(text);
  const source = createSemanticSourceSnapshot({
    bytes, repositoryNamespace: root, path: 'original.js', language: 'javascript'
  }).manifest;
  const original = path.join(root, 'original.js');
  await fs.writeFile(original, bytes);
  const stagingRoot = path.join(root, 'semantic');
  const partitionId = createSyntaxPartitionId({
    sourceUnitId: source.sourceUnitId, parser: { family: 'fixture', version: '1', options: {} },
    extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' }
  });
  const account = createSemanticDiskAccount(16 * 1024 * 1024);
  const options = { stagingRoot, source, sourceBytes: bytes, partitionId,
    producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount: account };
  const generation = { baseBuildId: 'recovery-build', semanticRevision: 0 };
  const store = (partitions, extra = {}) => createArtifactSemanticStore({
    root: stagingRoot, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    generation, partitions, ...extra
  });
  const write = async (rows = [semanticNode(0, source.textLength)], overrides = {}) => {
    const sink = await createSemanticPartitionSink({ ...options, ...overrides });
    const id = overrides.partitionId || partitionId;
    if (rows.length) await sink.appendBatch(semanticBatch(id, rows));
    return sink.finalizeSource();
  };
  const partDirectories = async () => (await fs.readdir(stagingRoot)).filter(name => name.startsWith('semantic-part-'));
  const cleanup = () => fs.rm(root, { recursive: true, force: true });
  return { root, bytes, source, original, stagingRoot, partitionId, account,
    options, generation, store, write, partDirectories, cleanup };
};
