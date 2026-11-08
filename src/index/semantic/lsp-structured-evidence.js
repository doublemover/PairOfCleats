import { createAnalysisPartitionId, semanticHash } from './identity.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from './analysis-versions.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Preserve structured observations as qualified evidence, never replacement
 * syntax, complete call targets, runtime dispatch or authoritative type trees. */
export const writeStructuredLspEvidence = async ({ observations, item, context, state, signal = null,
  declarationsForFact = () => [] }) => {
  if (!observations.length) return null;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'lsp-structured-evidence', version: SEMANTIC_ANALYSIS_VERSIONS.lspBindings },
    inputPartitionHashes: [item.syntax.canonicalHash], compilerContext: context.contextKey,
    dependencySummaryHashes: [context.moduleResolutionHash],
    analysisPolicy: { policy: item.policy.identity.analysis, observations: semanticHash('semantic.lsp-structured-responses.v1', observations) } });
  const rows = [];
  let edgeId = 0, nextNodeId = 0;
  for (const observation of observations) {
    throwIfAborted(signal);
    if (observation.identity.sourceUnitId !== item.source.sourceUnitId || observation.identity.sourceHash !== item.source.byteHash
      || observation.identity.contextHash !== context.contextKey) throw Object.assign(new Error('Structured LSP observation source/context mismatch.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
    const artifactRef = await persistSemanticEvidence({ value: observation, stagingRoot: item.root,
      diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal });
    const evidence = { partitionId, localId: nextNodeId++ };
    rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
      data: { method: observation.method, producerId: context.providerId, producerVersion: context.providerVersion,
        evidenceKind: 'lsp-structured-observation', sourceRef: item.source.sourceUnitId, artifactRef } } });
    for (const fact of observation.facts) {
      if (fact.target?.state !== 'exact') continue;
      const declarations = declarationsForFact(fact);
      if (declarations.length !== 1) continue;
      rows.push({ family: 'edge', row: { id: edgeId++, kind: 'evidenceInput', from: evidence, to: declarations[0].ref,
        callSite: null, operandOrdinal: null, contextKey: context.contextKey,
        condition: null, evidence, certainty: 'exact-static' } });
    }
  }
  return writeSemanticAnalysis({ rows, policy: item.policy, stagingRoot: item.root, source: item.source,
    sourceBytes: item.bytes, partitionId, producerHash: semanticHash('semantic.lsp-structured-producer.v1', { providerId: context.providerId,
      providerVersion: context.providerVersion, version: SEMANTIC_ANALYSIS_VERSIONS.lspBindings }),
    contextHash: context.contextKey, policyHash: semanticHash('semantic.lsp-structured-policy.v1', { evidence: 'qualified-observation-v1' }),
    structuralSlots: [], diskAccount: state.semanticDiskAccount, signal });
};
