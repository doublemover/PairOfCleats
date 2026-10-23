import { SEMANTIC_EDGE_KINDS } from '../contracts/schemas/semantic.js';
import { SEMANTIC_PATH_CAPABILITY_VERSION, SEMANTIC_TRACE_OPERAND_SLOTS,
  SEMANTIC_TRACE_PATH_SEMANTICS } from '../contracts/schemas/semantic-path.js';

const common = {
  schemaVersion: SEMANTIC_PATH_CAPABILITY_VERSION, feasibility: 'unsupported',
  unsupported: ['executable-path-feasibility', 'path-condition-solving', 'complete-runtime-behavior', 'complete-operand-association']
};
const semantic = (semantics, contextPolicy) => ({ ...common,
  id: 'semantic-path:' + semantics + ':v1', semantics, operation: 'semantic_trace',
  producer: { id: 'semantic-trace', version: '1' }, referenceKind: 'semantic-record-ref',
  scopeIdentity: 'semantic-generation-and-inventory', contextPolicy,
  directions: ['upstream', 'downstream'], edgeKindPolicy: 'semantic-edge-kinds', edgeKinds: [...SEMANTIC_EDGE_KINDS],
  operandSlots: [...SEMANTIC_TRACE_OPERAND_SLOTS], completeness: 'separate-extraction-analysis-response'
});
const declarations = [semantic('balanced-call-value', 'prefix-balanced-call-site-and-context-key'),
  semantic('relation-neighborhood', 'unrestricted-relations'), {
    ...common, id: 'semantic-path:graph-witness:v1', semantics: 'graph-witness', operation: 'graph_context',
    producer: { id: 'graph-context-pack', version: '1.0.0' }, referenceKind: 'graph-node-ref',
    scopeIdentity: 'index-signature', contextPolicy: 'graph-adjacency', directions: ['out', 'in', 'both'],
    edgeKindPolicy: 'graph-relation-kinds', edgeKinds: [], operandSlots: [], completeness: 'source-coverage-and-truncation'
  }];

/** Declarations describe existing distinct substrates, never interchangeable paths.
 * Returned copies grant no mutation or execution authority over their producers.
 */
export const getSemanticPathCapabilityDeclarations = () => structuredClone(declarations);
export const semanticTracePathDeclaration = (semantics = 'balanced-call-value', operation = 'semantic_trace') => {
  if (!SEMANTIC_TRACE_PATH_SEMANTICS.includes(semantics) || !['semantic_trace', 'semantic_explain'].includes(operation)) {
    throw Object.assign(new TypeError('Unsupported semantic path operation or semantics.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  }
  return { ...structuredClone(declarations.find(value => value.semantics === semantics)), operation };
};
export const semanticPathExecution = ({ declaration, store, request, limits, kinds }) => ({
  declaration, scope: { repoRoot: request.repoRoot, generation: { ...request.generation }, inventory: store.cursorScope },
  limits: { ...limits, callContextDepth: declaration.semantics === 'balanced-call-value' ? 16 : 0,
    visited: 16384, partitionsPerPage: 16, validationRecordsPerEdge: 6 }, selectedKinds: [...kinds],
  validation: 'retained-edge-and-call-context', execution: 'none'
});
