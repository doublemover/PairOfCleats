import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from '../analysis-versions.js';
import { persistSemanticEvidence } from '../lsp-evidence.js';
import { analyzeWasmModule } from './flow.js';
import { createWasmStructuralCatalog, consumeWasmStructuralCatalog } from './structure.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { canonicalSemanticJson } from '../identity.js';

export const isWasmStructureBudget = error => {
  const observation = observeStorageResource(error, { phase: 'wasm-structure-projection' });
  observation.requireSettled();
  let code;
  try { code = error?.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return ['ERR_WASM_STRUCTURE_BUDGET', 'ERR_SEMANTIC_JSON_BUDGET', 'ERR_SEMANTIC_EVIDENCE_BUDGET'].includes(code);
};
export const emptyWasmFlowCounts = (module, structural = {}) => ({
  decodedInstructions: module.decodedInstructionCount ?? null, functions: null, instructions: null, storage: null, structuralNodes: null,
  ...structural, flowAttempted: false,
  flowNodesAllocated: 0, flowEdgesConstructed: 0, retainedFlowNodes: 0, retainedFlowEdges: 0
});


const projectNode = (ledger, node, ref, { module, source, invocation, version }) => {
  let kind = node.kind, data;
  if (kind === 'storage') { kind = 'boundary'; data = { modelId: 'wasm/storage/' + module.byteHash + '/' + node.storageKind + '/' + node.index,
    modelVersion: version, invocation, boundaryKind: 'wasm-module-' + node.storageKind,
    fromContext: 'source:' + source.sourceUnitId, toContext: 'wasm:' + module.byteHash + ':' + node.storageKind + ':' + node.index }; }
  else if (kind === 'function') { kind = 'boundary'; data = { modelId: 'wasm/function/' + module.byteHash + '/' + node.index,
    modelVersion: version, invocation, boundaryKind: node.import ? 'wasm-module-import-function' : 'wasm-module-function',
    fromContext: 'source:' + source.sourceUnitId, toContext: 'wasm:' + module.byteHash + ':function:' + node.index }; }
  else if (kind === 'instruction') { kind = 'expression'; data = { astKind: 'WasmInstruction', operation: node.name,
    invocationKind: [16, 17, 18, 19, 20, 21].includes(node.opcode) ? 'call' : null, syntacticArgumentCount: null,
    flags: ['binary-offset-in-evidence', 'byte-offset:' + node.offset,
      ...(node.functionIndex == null ? ['expression-role:' + node.expressionRole] : ['function-index:' + node.functionIndex])] }; }
  else if (kind === 'value') data = { origin: node.origin, site: ref(node.site), storage: null };
  else data = { owner: ref(node.owner), blockKind: node.blockKind };
  ledger.rows.push({ family: 'node', row: { id: ref(node.id).localId, kind, span: null, scope: null, data } });
};
const evidenceNode = (ledger, evidence, { method, version, source, artifactRef }) => ledger.rows.push({ family: 'node',
  row: { id: evidence.localId, kind: 'evidence', span: null, scope: null, data: { method, producerId: 'semantic-wasm',
    producerVersion: version, evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef } } });

/** Structural evidence is persisted exactly once, before optional flow. Its
 * references and bytes do not depend on local-flow policy or solver success. */
export const projectWasmStructure = async ({ ledger, module: original, bytes, invocation, byteExpression = null,
  source, stagingRoot, state, binarySource = null, signal = null }) => {
  invocation = JSON.parse(canonicalSemanticJson(invocation, { maxBytes: 512 }));
  if (invocation) Object.freeze(invocation);
  source = Object.freeze({ sourceUnitId: source.sourceUnitId, byteHash: source.byteHash });
  const catalog = createWasmStructuralCatalog(original), module = consumeWasmStructuralCatalog(catalog, original);
  const start = ledger.nextId, partitionId = ledger.partitionId, ref = id => ({ partitionId, localId: start + id });
  const evidence = Object.freeze(ref(catalog.nodes.length)), version = SEMANTIC_ANALYSIS_VERSIONS.wasmStructure;
  const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 2, kind: 'wasm-binary-structure',
    producerVersion: version, validatorRuntime: WASM_VALIDATOR_RUNTIME, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
    invocation, byteExpression, binarySource, coordinateUnit: 'byte', byteHash: module.byteHash,
    byteLength: module.byteLength, bytesBase64: Buffer.from(bytes).toString('base64'), module, counts: catalog.counts,
    records: catalog.nodes.map(node => ({ ref: ref(node.id), kind: node.kind,
      functionIndex: node.kind === 'function' ? node.index : node.functionIndex ?? null,
      storageKind: node.storageKind || null, index: node.index ?? null,
      byteRange: node.kind === 'instruction' ? [node.offset, node.end] : node.byteRange ?? null,
      byteRangeRole: node.kind === 'instruction' ? 'instruction' : node.byteRangeRole ?? null })) },
  stagingRoot, diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal, maxBytes: 4 * 1024 * 1024 });
  for (const node of catalog.nodes) projectNode(ledger, node, ref, { module, source, invocation, version });
  evidenceNode(ledger, evidence, { method: 'bounded-wasm-binary-structure', version, source, artifactRef });
  ledger.nextId += catalog.nodes.length + 1;
  return Object.freeze({ catalog, module, ref, evidence, artifactRef, invocation, source });
};

/** One catalog for standalone and host-instantiated modules. Flow consumes its
 * stable IDs and adds only derived nodes, operands and edges to its own ledger. */
export const projectWasmModule = async ({ ledger, module, bytes, invocation, byteExpression = null,
  source, stagingRoot, state, binarySource = null, contextKey = null, includeFlow = true, signal = null,
  structure = null, analyze = analyzeWasmModule }) => {
  if (!structure) {
    try { structure = await projectWasmStructure({ ledger, module, bytes, invocation, byteExpression, source, stagingRoot, state, binarySource, signal }); }
    catch (error) {
      if (!isWasmStructureBudget(error)) throw error;
      ledger.reasons.add('wasm_structural_projection_budget');
      return { graph: null, structure: null, flow: { state: 'structure-budget', counts: emptyWasmFlowCounts(module) } };
    }
  }
  consumeWasmStructuralCatalog(structure.catalog, module);
  invocation = structure.invocation; source = structure.source;
  const counts = { ...emptyWasmFlowCounts(structure.module, structure.catalog.counts), flowAttempted: includeFlow };
  if (!includeFlow) return { ...structure, graph: null, flow: { state: 'not-requested', counts } };
  let graph;
  try { graph = analyze(module, { signal, catalog: structure.catalog }); }
  catch (error) {
    const observation = observeStorageResource(error, { phase: 'wasm-flow-construction' });
    observation.requireSettled();
    let code, workNodes, workEdges;
    try { code = error?.code; if (code === 'ERR_WASM_FLOW_BUDGET') { const work = error?.work; workNodes = work?.nodes; workEdges = work?.edges; } }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (code !== 'ERR_WASM_FLOW_BUDGET') throw error;
    counts.flowNodesAllocated = Number.isSafeInteger(workNodes) && workNodes >= 0 ? workNodes : null;
    counts.flowEdgesConstructed = Number.isSafeInteger(workEdges) && workEdges >= 0 ? workEdges : null;
    ledger.reasons.add('wasm_flow_graph_budget');
    return { ...structure, graph: null, flow: { state: 'budget', counts } };
  }
  const structuralCount = structure.catalog.nodes.length, start = ledger.nextId, partitionId = ledger.partitionId;
  const ref = id => id < structuralCount ? structure.ref(id) : { partitionId, localId: start + id - structuralCount };
  const derived = graph.nodes.slice(structuralCount), evidence = ref(graph.nodes.length), version = SEMANTIC_ANALYSIS_VERSIONS.wasmFlow;
  for (const node of derived) projectNode(ledger, node, ref, { module: structure.module, source, invocation, version });
  evidenceNode(ledger, evidence, { method: 'bounded-wasm-binary-stack-control-flow', version, source, artifactRef: structure.artifactRef });
  ledger.nextId += derived.length + 1;
  const emit = (kind, from, to, callSite = invocation, ordinal = null, certainty = 'modeled', condition = null) => {
    if (from && to) ledger.edges.push({ kind, from, to, callSite, operandOrdinal: ordinal, contextKey, condition, evidence, certainty });
  };
  for (const item of graph.edges) {
    emit(item.kind, ref(item.from), ref(item.to), item.callSite == null ? null : ref(item.callSite), item.slot === 'callee' ? null : item.ordinal ?? null,
      item.certainty || (item.kind === 'callTarget' ? 'exact-static' : 'modeled'), item.condition == null ? null : ref(item.condition));
    if (item.kind === 'consumes' && graph.nodes[item.to].kind === 'instruction') ledger.rows.push({ family: 'operand', row: {
      parent: ref(item.to), slot: item.slot || 'argument', ordinal: item.ordinal, child: ref(item.from), flags: [] } });
  }
  for (const reason of graph.reasons) ledger.reasons.add(reason);
  ledger.reasons.add('wasm_static_module_instance_candidate_no_runtime_execution_claim');
  counts.flowNodesAllocated = counts.retainedFlowNodes = derived.length;
  counts.flowEdgesConstructed = counts.retainedFlowEdges = graph.edges.length;
  return { graph, ref, emit, module: structure.module, invocation, structure, flow: { state: 'analyzed-static', counts } };
};
