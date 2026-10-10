import { createWasmSourceSnapshot } from '../source.js';
import { createSyntaxPartitionId, createAnalysisPartitionId, semanticHash } from '../identity.js';
import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from '../analysis-versions.js';
import { planSemanticSource } from '../planning.js';
import { resolveSemanticSourcePolicy } from '../policy.js';
import { writeSemanticAnalysis } from '../analysis-write.js';
import { createSemanticFactsRef } from '../file-ref.js';
import { decodeWasmModule } from './decode.js';
import { projectWasmModule } from './project.js';

/** Module-only files use normal completion/publication and derived replay fences,
 * without fake text chunks or a second cache, lease or storage owner. */
export const collectStandaloneWasm = async ({ bytes, relPath, repositoryNamespace, stagingRoot, storage, diskAccount, policy, signal }) => {
  const source = createWasmSourceSnapshot({ bytes, repositoryNamespace, path: relPath });
  const effective = resolveSemanticSourcePolicy(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, path: relPath, language: 'wasm' });
  const parser = { family: 'wasm-binary', version: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow, runtime: WASM_VALIDATOR_RUNTIME };
  const structuralPolicy = { extraction: effective.identity.extraction, languageEnabled: effective.languages.includes('wasm') };
  const syntaxPartitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser,
    extractor: { schemaVersion: 1, version: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow }, structuralPolicy });
  const invocation = { partitionId: syntaxPartitionId, localId: 0 };
  const decoded = effective.languages.includes('wasm') ? decodeWasmModule(bytes, { signal }) : { status: 'disabled', reason: 'language_policy_disabled' };
  const coverage = [{ scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax', state: decoded.status === 'decoded' ? 'complete' : decoded.status,
    reason: decoded.reason || null, observedCount: decoded.module?.functions.length ?? null, completedCount: decoded.module?.functions.length || 0, frontierRef: null }];
  const common = { policy: effective, stagingRoot, source, sourceBytes: bytes, diskAccount, signal };
  const syntax = await writeSemanticAnalysis({ ...common, partitionId: syntaxPartitionId,
    producerHash: semanticHash('semantic.wasm-binary-producer.v1', parser), policyHash: semanticHash('semantic.wasm-structure.v1', structuralPolicy),
    rows: [{ family: 'node', row: { id: 0, kind: 'expression', span: null, scope: null, data: {
      astKind: 'WasmModule', operation: 'module', invocationKind: null, syntacticArgumentCount: null, flags: []
    } } }, { family: 'coverage', row: coverage[0] }] });
  const partitions = [syntax], state = { semanticDiskAccount: diskAccount, semanticEvidenceArtifacts: [] };
  if (decoded.status === 'decoded') {
    const plan = planSemanticSource(effective, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId, reuseReady: true });
    const targeted = effective.targetSelectionConfigured;
    const moduleTarget = effective.targets.some(target=>target.ref?.partitionId===syntaxPartitionId&&target.ref.localId===0);
    const supportedTarget = !targeted || moduleTarget;
    const includeFlow = supportedTarget && plan.modes.localFlow === 'eager';
    const partitionId = createAnalysisPartitionId({ pass: 'wasm-binary', inputPartitionHashes: [syntax.canonicalHash],
      compilerContext: parser, dependencySummaryHashes: [], analysisPolicy: effective.identity.analysis });
    const ledger = { partitionId, rows: [], edges: [], reasons: new Set(), nextId: 0 };
    if(moduleTarget)ledger.reasons.add('wasm_module_target_widens_to_whole_module');
    const projected = await projectWasmModule({ ledger, module: decoded.module, bytes, invocation, source, stagingRoot, state, includeFlow, signal });
    ledger.edges.forEach((row, id) => ledger.rows.push({ family: 'edge', row: { id, ...row } }));
    const flowCoverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow',
      state: !projected ? 'partial' : includeFlow ? 'partial' : plan.modes.localFlow === 'off' ? 'disabled' : 'unsupported',
      reason: !projected ? 'wasm_flow_graph_budget' : includeFlow ? [...ledger.reasons].sort().join(';') : !supportedTarget ? 'wasm_text_or_declaration_target_not_supported' : plan.modes.localFlow === 'off' ? 'wasm_local_flow_off' : 'wasm_deferred_flow_not_scheduled',
      observedCount: projected?.graph.nodes.length ?? null, completedCount: projected && includeFlow ? projected.graph.functions.length : 0, frontierRef: null };
    ledger.rows.push({ family: 'coverage', row: flowCoverage }); coverage.push(flowCoverage);
    partitions.push(await writeSemanticAnalysis({ ...common, rows: ledger.rows, partitionId,
      producerHash: semanticHash('semantic.wasm-analysis-producer.v1', parser), policyHash: effective.identity.analysis }));
  }
  return { chunks: [], fileRelations: null, fileLanguageId: 'wasm', fileLineCount: 0,
    semanticEvidenceArtifacts: state.semanticEvidenceArtifacts,
    semanticFactsRef: createSemanticFactsRef({ source, partitions, syntaxPartitionId, storage, coverage }) };
};
