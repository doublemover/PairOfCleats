import assert from 'node:assert/strict';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';
import { writeStructuredLspEvidence } from '../../../src/index/semantic/lsp-structured-evidence.js';
import { readLspObservationDetail } from '../../../src/semantic/lsp-observation-detail.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';

const f = await createRecoveryFixture('value();');
try {
  const syntax = await f.write([semanticNode(0, f.source.textLength)]);
  const policy = { ...normalizeSemanticConfig({ enabled: true }), identity: { analysis: 'fixture-analysis' } };
  const context = { contextKey: 'c'.repeat(64), moduleResolutionHash: 'd'.repeat(64), providerId: 'lua-fixture', providerVersion: '1' };
  const uri = 'file:///fixture/original.js', range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
  const collector = createLspObservationCollector({ identity: { sessionId: 'session', profileId: 'source-qualified-fixture',
    generation: f.generation, sourceUnitId: f.source.sourceUnitId, sourceHash: f.source.byteHash, contextHash: context.contextKey, uri },
  consumers: ['navigation'], sourceForUri: value => value === uri ? { source: f.source, text: f.bytes.toString() } : null });
  collector.record({ requestClass: 'definition', params: { textDocument: { uri }, position: range.start },
    response: { attempted: true, payload: [{ uri, range }] } });
  const partition = await writeStructuredLspEvidence({ observations: collector.observations(), context,
    item: { syntax, source: f.source, bytes: f.bytes, root: f.stagingRoot, policy },
    state: { semanticDiskAccount: f.account, semanticEvidenceArtifacts: [] } });
  const store = f.store([syntax, partition]), ref = { partitionId: partition.partitionId, localId: 0 };
  const detail = await createSemanticDetailService()({ store, request: { repoRoot: f.root, generation: f.generation, refs: [ref] } });
  assert.equal(detail.records[0].data.evidenceKind, 'lsp-structured-observation');
  const observation = await readLspObservationDetail({ store, ref });
  assert.equal(observation.navigationCandidates[0].sourceHash, f.source.byteHash);
  assert.deepEqual(observation.navigationCandidates[0].span, [0, 5]);
  assert.equal(observation.observation.state, 'partial', 'initialized transport does not prove project analysis readiness');
  const projected = await createSemanticDetailService()({ store, request: { repoRoot: f.root,
    generation: f.generation, refs: [ref], include: ['providerEvidence'] } });
  assert.equal(projected.providerEvidence[0].qualification, 'provider-observation');
  assert.equal(projected.providerEvidence[0].target, undefined, 'captured target is not independently qualified published navigation');
  assert.deepEqual(projected.providerEvidence[0].observedTarget.span, [0, 5]);
  await assert.rejects(readLspObservationDetail({ store: { ...store, generation: { baseBuildId: 'wrong', semanticRevision: 0 } }, ref }), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
  console.log('retained structured LSP evidence through canonical semantic detail and source-qualified navigation candidates');
} finally { await f.cleanup(); }
