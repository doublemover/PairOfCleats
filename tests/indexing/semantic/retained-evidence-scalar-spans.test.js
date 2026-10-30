import assert from 'node:assert/strict';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createAnalysisPartitionId, createSyntaxPartitionId, semanticHash } from '../../../src/index/semantic/identity.js';
import { persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { readLspObservationDetail } from '../../../src/semantic/lsp-observation-detail.js';

// Authored only: fatal streaming UTF8 decode -> exact scalar spans; no parser/provider execution.
const streamed = await createRecoveryFixture('x'.repeat(65535) + '😀after');
try {
  const syntax = await streamed.write([semanticNode(0, streamed.source.textLength)]), store = streamed.store([syntax]);
  await store.verifySource(streamed.source, { spans: [[65535, 65537], [0, 0], [streamed.source.textLength, streamed.source.textLength]] });
  await assert.rejects(store.verifySource(streamed.source, { spans: [[65536, 65537]] }), { code: 'ERR_SEMANTIC_INTEGRITY' },
    'a scalar split across physical UTF8 read chunks still has one indivisible UTF16 span');
  await assert.rejects(store.verifySource(streamed.source, { spans: [[0, streamed.source.textLength + 1]] }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  await assert.rejects(store.verifySource(streamed.source, { spans: [[3, 1]] }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(store.verifySource(streamed.source, { signal: canceled.signal }), { name: 'AbortError' });
} finally { await streamed.cleanup(); }

const f = await createRecoveryFixture('before😀after');
try {
  const syntax = await f.write([semanticNode(0, f.source.textLength)]);
  const targetSource = createSemanticSourceSnapshot({ bytes: f.bytes, repositoryNamespace: f.root,
    path: 'target.js', language: 'javascript' }).manifest;
  const targetId = createSyntaxPartitionId({ sourceUnitId: targetSource.sourceUnitId,
    parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
  const targetSyntax = await f.write([semanticNode(0, targetSource.textLength)], { source: targetSource, sourceBytes: f.bytes, partitionId: targetId });
  const inventory = [], partitions = [syntax, targetSyntax];
  const writeEvidence = async (value, kind, method, label) => {
    const artifactRef = await persistSemanticEvidence({ value, stagingRoot: f.stagingRoot, diskAccount: f.account, inventory });
    const partitionId = createAnalysisPartitionId({ pass: { name: label, version: '1' }, inputPartitionHashes: [syntax.canonicalHash],
      compilerContext: 'fixture-scalar-span', dependencySummaryHashes: [], analysisPolicy: {} });
    const partition = await f.write([{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method, producerId: 'scalar-span-fixture', producerVersion: '1', evidenceKind: kind,
        sourceRef: f.source.sourceUnitId, artifactRef } } }], { partitionId, contextHash: 'c'.repeat(64) });
    partitions.push(partition);
    return { store: f.store(partitions), ref: { partitionId, localId: 0 } };
  };
  const sourceLinked = async (references, label) => {
    const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'scalar-span-fixture', adapterVersion: '1',
      method: 'fixture/scalar-spans', evidenceKind: 'configuration-local-references', generation: f.generation,
      project: { configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) }, runtime: { family: 'fixture', version: '1', qualification: 'authored-only', profileHash: null },
      results: [{ path: f.source.path, sourceUnitId: f.source.sourceUnitId, sourceHash: f.source.byteHash,
        state: 'partial', references, diagnostics: [] }] };
    report.identity = semanticHash('tooling.source-linked-evidence.v1', report);
    return writeEvidence({ schemaVersion: 1, kind: 'source-linked-evidence-sidecar', report,
      sourcePartitions: [{ sourceUnitId: f.source.sourceUnitId, sourceHash: f.source.byteHash, partitionId: syntax.partitionId },
        { sourceUnitId: targetSource.sourceUnitId, sourceHash: targetSource.byteHash, partitionId: targetSyntax.partitionId }] },
    'configuration-local-references', report.method, label);
  };
  const invalidFrom = await sourceLinked([{ name: 'split', family: 'fixture-reference', span: [6, 7], state: 'unresolved', target: null }], 'bad-from-scalar');
  await assert.rejects(readSourceLinkedEvidenceDetail(invalidFrom), { code: 'ERR_SEMANTIC_INTEGRITY' });
  const target = span => ({ path: targetSource.path, sourceUnitId: targetSource.sourceUnitId, sourceHash: targetSource.byteHash, span });
  const invalidSecondTarget = await sourceLinked([
    { name: 'first', family: 'fixture-reference', span: [0, 1], state: 'resolved', target: target([0, 1]) },
    { name: 'second', family: 'fixture-reference', span: [1, 2], state: 'resolved', target: target([6, 7]) }
  ], 'bad-second-target-scalar');
  await assert.rejects(readSourceLinkedEvidenceDetail({ ...invalidSecondTarget, targetStoreForSource: () => invalidSecondTarget.store }),
    { code: 'ERR_SEMANTIC_INTEGRITY' }, 'one verified target source must check every requested target range, not only its first range');
  const valid = await sourceLinked([{ name: 'scalar', family: 'fixture-reference', span: [6, 8], state: 'resolved', target: target([6, 8]) }], 'valid-scalar-target');
  const detail = await readSourceLinkedEvidenceDetail({ ...valid, targetStoreForSource: () => valid.store });
  assert.deepEqual(detail.navigationCandidates[0].span, [6, 8]);
  const observation = { schemaVersion: 1, method: 'textDocument/definition', identity: { generation: f.generation,
    sourceUnitId: f.source.sourceUnitId, sourceHash: f.source.byteHash }, facts: [{ kind: 'definition',
    target: { state: 'exact', sourceUnitId: f.source.sourceUnitId, sourceHash: f.source.byteHash, span: [6, 7] } }] };
  const badLsp = await writeEvidence(observation, 'lsp-structured-observation', observation.method, 'bad-lsp-scalar');
  await assert.rejects(readLspObservationDetail(badLsp), { code: 'ERR_SEMANTIC_INTEGRITY' });
} finally { await f.cleanup(); }
console.log('retained source streaming and provider evidence scalar-span controls passed');
