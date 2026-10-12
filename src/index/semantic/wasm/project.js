import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from '../analysis-versions.js';
import { persistSemanticEvidence } from '../lsp-evidence.js';
import { analyzeWasmModule } from './flow.js';

/** One projection contract for source-owned binaries and host-instantiated modules. */
export const projectWasmModule = async ({ ledger, module, bytes, invocation, byteExpression = null,
  source, stagingRoot, state, binarySource = null, contextKey = null, includeFlow = true, signal = null }) => {
  let graph;
  try { graph = analyzeWasmModule(module, { signal }); }
  catch (error) { if (error.code !== 'ERR_WASM_FLOW_BUDGET') throw error; ledger.reasons.add('wasm_flow_graph_budget'); return null; }
  const start = ledger.nextId, ref = id => ({ partitionId: ledger.partitionId, localId: start + id });
  const evidence = { partitionId: ledger.partitionId, localId: start + graph.nodes.length };
  const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 1, kind: 'wasm-binary-analysis',
    producerVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow, validatorRuntime: WASM_VALIDATOR_RUNTIME,
    sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
    invocation, byteExpression, binarySource, coordinateUnit: 'byte', byteHash: module.byteHash,
    byteLength: module.byteLength, bytesBase64: bytes.toString('base64'), module,
    records: graph.nodes.filter(node => ['instruction', 'function', 'storage'].includes(node.kind)).map(node => ({
      ref: ref(node.id), kind: node.kind, functionIndex: node.functionIndex ?? node.index, storageKind: node.storageKind || null,
      byteRange: node.kind === 'instruction' ? [node.offset, node.end] : null
    })) }, stagingRoot: stagingRoot, diskAccount: state.semanticDiskAccount,
  inventory: state.semanticEvidenceArtifacts, signal, maxBytes: 4 * 1024 * 1024 });
  for (const node of graph.nodes) {
    let kind = node.kind, data;
    if (kind === 'storage') { kind = 'boundary'; data = { modelId: 'wasm/storage/' + module.byteHash + '/' + node.storageKind + '/' + node.index, modelVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow, invocation, boundaryKind: 'wasm-module-' + node.storageKind, fromContext: 'source:' + source.sourceUnitId, toContext: 'wasm:' + module.byteHash + ':' + node.storageKind + ':' + node.index }; }
    else if (kind === 'function') { kind = 'boundary'; data = { modelId: 'wasm/function/' + module.byteHash + '/' + node.index, modelVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow,
      invocation, boundaryKind: node.import ? 'wasm-module-import-function' : 'wasm-module-function',
      fromContext: 'source:' + source.sourceUnitId, toContext: 'wasm:' + module.byteHash + ':function:' + node.index }; }
    else if (kind === 'instruction') { kind = 'expression'; data = { astKind: 'WasmInstruction', operation: node.name,
      invocationKind: [16, 17, 18, 19, 20, 21].includes(node.opcode) ? 'call' : null, syntacticArgumentCount: null,
      flags: ['binary-offset-in-evidence', 'function-index:' + node.functionIndex, 'byte-offset:' + node.offset] }; }
    else if (kind === 'value') data = { origin: node.origin, site: ref(node.site), storage: null };
    else data = { owner: ref(node.owner), blockKind: node.blockKind };
    ledger.rows.push({ family: 'node', row: { id: ref(node.id).localId, kind, span: null, scope: null, data } });
  }
  ledger.nextId += graph.nodes.length + 1;
  ledger.rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
    data: { method: 'bounded-wasm-binary-stack-control-flow', producerId: 'semantic-wasm', producerVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow,
      evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef } } });
  const emit = (kind, from, to, callSite = invocation, ordinal = null, certainty = 'modeled', condition = null) => {
    if (from && to) ledger.edges.push({ kind, from, to, callSite, operandOrdinal: ordinal, contextKey: contextKey, condition, evidence, certainty });
  };
  for (const item of includeFlow ? graph.edges : []) {
    emit(item.kind, ref(item.from), ref(item.to), item.callSite == null ? null : ref(item.callSite), item.slot === 'callee' ? null : item.ordinal ?? null,
      item.certainty || (item.kind === 'callTarget' ? 'exact-static' : 'modeled'), item.condition == null ? null : ref(item.condition));
    if (item.kind === 'consumes' && graph.nodes[item.to].kind === 'instruction') ledger.rows.push({ family: 'operand', row: {
      parent: ref(item.to), slot: item.slot || 'argument', ordinal: item.ordinal, child: ref(item.from), flags: []
    } });
  }
  for (const reason of graph.reasons) ledger.reasons.add(reason);
  const result = { graph, ref, emit, module, invocation };
  ledger.reasons.add('wasm_static_module_instance_candidate_no_runtime_execution_claim');
  return result;
};
