import { createWasmSourceSnapshot } from '../source.js';
import { createSyntaxPartitionId, createAnalysisPartitionId, semanticHash } from '../identity.js';
import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from '../analysis-versions.js';
import { planSemanticSource } from '../planning.js';
import { resolveSemanticSourcePolicy } from '../policy.js';
import { writeSemanticAnalysis } from '../analysis-write.js';
import { createSemanticFactsRef } from '../file-ref.js';
import { decodeWasmModule, WASM_LIMITS } from './decode.js';
import { projectWasmModule, projectWasmStructure, isWasmStructureBudget, emptyWasmFlowCounts } from './project.js';

/** Module-only files use normal completion/publication and derived replay fences,
 * without fake text chunks or a second cache, lease or storage owner. */
export const collectStandaloneWasm = async ({ bytes, relPath, repositoryNamespace, stagingRoot, storage, diskAccount, policy, flowGranted = false, signal, analyzeWasm = undefined }) => {
  // Admitted modules own their source bytes before any asynchronous evidence or
  // callback. Oversize files keep the existing bounded unsupported-source path.
  if (bytes instanceof Uint8Array && bytes.byteLength <= WASM_LIMITS.bytes) bytes = Buffer.from(bytes);
  const source = createWasmSourceSnapshot({ bytes, repositoryNamespace, path: relPath });
  const effective = resolveSemanticSourcePolicy(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, path: relPath, language: 'wasm' });
  const parser = { family: 'wasm-binary', version: SEMANTIC_ANALYSIS_VERSIONS.wasmStructure, runtime: WASM_VALIDATOR_RUNTIME };
  const structuralPolicy = { extraction: effective.identity.extraction, languageEnabled: effective.languages.includes('wasm') };
  const syntaxPartitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser,
    extractor: { schemaVersion: 1, version: SEMANTIC_ANALYSIS_VERSIONS.wasmStructure }, structuralPolicy });
  const invocation = { partitionId: syntaxPartitionId, localId: 0 };
  const decoded = effective.languages.includes('wasm') ? decodeWasmModule(bytes, { signal }) : { status: 'disabled', reason: 'language_policy_disabled' };
  const coverage = [{ scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax', state: decoded.status === 'decoded' ? 'complete' : decoded.status,
    reason: decoded.reason || null, observedCount: decoded.module?.functions.length ?? null, completedCount: decoded.module?.functions.length || 0, frontierRef: null }];
  const common = { policy: effective, stagingRoot, source, sourceBytes: bytes, diskAccount, signal };
  const state = { semanticDiskAccount: diskAccount, semanticEvidenceArtifacts: [] };
  const syntaxLedger = { partitionId: syntaxPartitionId, rows: [{ family: 'node', row: {
    id: 0, kind: 'expression', span: null, scope: null, data: { astKind: 'WasmModule', operation: 'module',
      invocationKind: null, syntacticArgumentCount: null, flags: [] } } }], edges: [], reasons: new Set(), nextId: 1 };
  let structure = null;
  if (decoded.status === 'decoded') {
    try { structure = await projectWasmStructure({ ledger: syntaxLedger, module: decoded.module, bytes, invocation, source, stagingRoot, state, signal }); }
    catch (error) {
      if (!isWasmStructureBudget(error)) throw error;
      coverage[0] = { ...coverage[0], state: 'partial', reason: 'wasm_structural_projection_budget', completedCount: 0 };
    }
  }
  syntaxLedger.rows.push({ family: 'coverage', row: coverage[0] });
  const syntax = await writeSemanticAnalysis({ ...common, partitionId: syntaxPartitionId,
    producerHash: semanticHash('semantic.wasm-binary-producer.v2', parser), policyHash: semanticHash('semantic.wasm-structure.v1', structuralPolicy),
    rows: syntaxLedger.rows });
  const partitions = [syntax];
  let wasmConstruction = decoded.module ? emptyWasmFlowCounts(decoded.module, structure?.catalog.counts) : null;
  if (decoded.status === 'decoded') {
    const plan = planSemanticSource(effective, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId, reuseReady: true });
    const targeted = effective.targetSelectionConfigured;
    const moduleTarget = effective.targets.some(target=>target.ref?.partitionId===syntaxPartitionId&&target.ref.localId===0);
    const supportedTarget = !targeted || moduleTarget;
    const includeFlow = supportedTarget && (plan.modes.localFlow === 'eager' || flowGranted && plan.modes.localFlow !== 'off');
    const partitionId = createAnalysisPartitionId({ pass: 'wasm-binary', inputPartitionHashes: [syntax.canonicalHash],
      compilerContext: parser, dependencySummaryHashes: [], analysisPolicy: {policy:effective.identity.analysis,includeFlow,producerVersion:SEMANTIC_ANALYSIS_VERSIONS.wasmFlow} });
    const ledger = { partitionId, rows: [], edges: [], reasons: new Set(), nextId: 0 };
    if(moduleTarget)ledger.reasons.add('wasm_module_target_widens_to_whole_module');
    const projected = structure ? await projectWasmModule({ ledger, module: decoded.module, bytes, invocation, source, stagingRoot, state,
      includeFlow, signal, structure, analyze: analyzeWasm }) : { graph: null, flow: { state: 'structure-budget', counts: wasmConstruction } };
    wasmConstruction = projected.flow.counts;
    ledger.edges.forEach((row, id) => ledger.rows.push({ family: 'edge', row: { id, ...row } }));
    const flowCoverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow',
      state: includeFlow ? 'partial' : plan.modes.localFlow === 'off' ? 'disabled' : !supportedTarget ? 'unsupported' : 'deferred',
      reason: projected.flow.state === 'budget' ? 'wasm_flow_graph_budget' : includeFlow && !structure ? 'wasm_structure_catalog_unavailable' : includeFlow ? [...ledger.reasons].sort().join(';') : plan.modes.localFlow === 'off' ? 'wasm_local_flow_off' : !supportedTarget ? 'wasm_text_or_declaration_target_not_supported' : 'wasm_deferred_flow_requires_task',
      observedCount: includeFlow ? wasmConstruction.flowNodesAllocated : null, completedCount: projected.graph?.functions.length || 0, frontierRef: null };
    ledger.rows.push({ family: 'coverage', row: flowCoverage }); coverage.push(flowCoverage);
    partitions.push(await writeSemanticAnalysis({ ...common, rows: ledger.rows, partitionId,
      producerHash: semanticHash('semantic.wasm-analysis-producer.v2', { ...parser, flowVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow }), policyHash: effective.identity.analysis }));
  }
  return { chunks: [], fileRelations: null, fileLanguageId: 'wasm', fileLineCount: 0,
    wasmConstruction, semanticEvidenceArtifacts: state.semanticEvidenceArtifacts,
    semanticFactsRef: createSemanticFactsRef({ source, partitions, syntaxPartitionId, storage, coverage }) };
};
