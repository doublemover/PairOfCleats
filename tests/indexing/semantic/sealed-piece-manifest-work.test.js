import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { enqueueSemanticArtifacts } from '../../../src/index/build/artifacts/writers/semantic/family.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createManifestWorkProbe } from '../../helpers/manifest-work-probe.js';

const { dir: root } = await prepareIsolatedTestCacheDir('sealed-semantic-manifest-work');
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const outDir = path.join(root, 'index-code'), semanticRoot = path.join(outDir, 'semantic');
const bytes = Buffer.from('first(); second(); third();');
const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: root, path: 'source.js', language: 'javascript' });
const account = createSemanticDiskAccount(16 * 1024 * 1024), partitions = [], buildId = 'sealed-manifest-fixture';
const generation = { baseBuildId: buildId, semanticRevision: 0 };
await fs.mkdir(path.join(semanticRoot, 'semantic-sources'), { recursive: true });
await fs.writeFile(path.join(semanticRoot, 'semantic-sources', snapshot.manifest.byteHash + '.utf8'), bytes); account.reserve(bytes.length);
try {
  for (let index = 0; index < 2; index++) {
    const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
      parser: { family: 'fixture', version: '1', options: { partition: index } },
      extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: {} });
    const sink = await createSemanticPartitionSink({ stagingRoot: semanticRoot, source: snapshot.manifest,
      sourceBytes: bytes, sourceCapability: snapshot.sourceCapability, partitionId, producerHash: 'a'.repeat(64),
      policyHash: 'b'.repeat(64), diskAccount: account, batchRows: 1 });
    if (index === 0) for (let id = 0; id < 3; id++) {
      await sink.appendBatch(semanticBatch(partitionId, [semanticNode(id, snapshot.manifest.textLength)], id));
    }
    partitions.push(await sink.finalizeSource());
  }
  assert.ok(partitions[0].members.semantic_records.length >= 3, 'actual sealed semantic data spans multiple parts');
  assert.deepEqual(partitions[1].members.semantic_records, [], 'the empty partition does not invent data or offsets');
  const facts = createSemanticFactsRef({ source: snapshot.manifest, partitions, syntaxPartitionId: partitions[0].partitionId,
    storage: { generation, relativePath: 'index-code/semantic' }, coverage: [] });
  const registry = createArtifactPieceRegistry({ outDir }), jobs = [];
  enqueueSemanticArtifacts({ state: { semanticFactsByFile: new Map([['source.js', facts]]), semanticDiskAccount: account },
    root, outDir, indexState: { buildId }, enabled: true, enqueueWrite: (_label, work) => jobs.push(work),
    addPieceFile: registry.addPieceFile, declareArtifactFamily: () => {} });
  for (const work of jobs) await work();
  const pieces = registry.listPieceEntries(), sealed = pieces.filter(piece => piece.checksum?.startsWith('sha256:'));
  assert.ok(sealed.some(piece => piece.name.endsWith('_offsets')));
  const sealedPaths = new Set(sealed.map(piece => path.resolve(outDir, piece.path)));
  const probe = createManifestWorkProbe();
  let firstManifest, controlManifest, fullControlBytes = 0;
  try {
    const { writePiecesManifest } = await import('../../../src/index/build/artifacts/checksums.js');
    const publish = pieceEntries => writePiecesManifest({ outDir, mode: 'code', indexState: { buildId }, pieceEntries });
    await publish(pieces);
    firstManifest = JSON.parse(await fs.readFile(path.join(outDir, 'pieces', 'manifest.json'), 'utf8'));
    assert.equal(probe.metrics.checksums.filter(call => sealedPaths.has(path.resolve(call.filename))).length, 0,
      'manifest construction cannot reread already sealed semantic data or offsets');
    assert.ok(probe.metrics.checksums.length > 0, 'ordinary generated metadata remains on its original checksum path');
    const control = [];
    for (const piece of pieces) {
      if (!sealedPaths.has(path.resolve(outDir, piece.path))) { control.push(piece); continue; }
      const stored = await fs.readFile(path.join(outDir, piece.path)); fullControlBytes += stored.length;
      const checksum = 'sha256:' + createHash('sha256').update(stored).digest('hex');
      assert.equal(checksum, piece.checksum);
      control.push({ ...piece, bytes: stored.length, checksum });
    }
    await publish(control);
    controlManifest = JSON.parse(await fs.readFile(path.join(outDir, 'pieces', 'manifest.json'), 'utf8'));
  } finally { probe.close(); }
  delete firstManifest.generatedAt; delete controlManifest.generatedAt;
  assert.deepEqual(firstManifest, controlManifest, 'writer receipts match the full stored-byte SHA256 control manifest');
  const store = () => createArtifactSemanticStore({ root: semanticRoot, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    generation, partitions });
  const refs = Array.from({ length: 3 }, (_, localId) => ({ partitionId: partitions[0].partitionId, localId }));
  assert.deepEqual((await store().getRecords(refs)).map(row => row.id), [0, 1, 2]);
  const part = path.join(semanticRoot, partitions[0].members.semantic_records[0].path), stored = await fs.readFile(part);
  stored[0] ^= 1; await fs.writeFile(part, stored);
  await assert.rejects(store().getRecords([refs[0]]), { code: 'ERR_SEMANTIC_INTEGRITY' },
    'independent original semantic validation must reject same-size corruption after manifest construction');
  console.log(JSON.stringify({ manifestConstruction: probe.metrics, sealedPieces: sealed.length,
    independentControlReadBytes: fullControlBytes, canonicalManifestParity: true, independentCorruptionRejected: true }));
} finally {
  const relative = path.relative(process.cwd(), root);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
  await fs.rm(root, { recursive: true, force: true });
}
