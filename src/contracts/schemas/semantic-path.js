import { SEMANTIC_EDGE_KINDS } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text } from './semantic-envelopes.js';

export const SEMANTIC_PATH_CAPABILITY_VERSION = 1;
export const SEMANTIC_TRACE_PATH_SEMANTICS = Object.freeze(['balanced-call-value', 'relation-neighborhood']);
export const SEMANTIC_TRACE_OPERAND_SLOTS = Object.freeze([
  'input', 'output', 'argument', 'receiver', 'parameter', 'returnValue', 'propertyValue', 'element'
]);
export const SEMANTIC_PATH_DECLARATION_SCHEMA = object({
  schemaVersion: { const: SEMANTIC_PATH_CAPABILITY_VERSION }, id: text,
  semantics: { enum: [...SEMANTIC_TRACE_PATH_SEMANTICS, 'graph-witness'] },
  operation: { enum: ['semantic_trace', 'semantic_explain', 'graph_context'] },
  producer: object({ id: text, version: text }),
  referenceKind: { enum: ['semantic-record-ref', 'graph-node-ref'] },
  scopeIdentity: { enum: ['semantic-generation-and-inventory', 'index-signature'] },
  contextPolicy: { enum: ['prefix-balanced-call-site-and-context-key', 'unrestricted-relations', 'graph-adjacency'] },
  directions: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['upstream', 'downstream', 'out', 'in', 'both'] } },
  edgeKindPolicy: { enum: ['semantic-edge-kinds', 'graph-relation-kinds'] },
  edgeKinds: { type: 'array', uniqueItems: true, items: { enum: SEMANTIC_EDGE_KINDS } },
  operandSlots: { type: 'array', uniqueItems: true, items: { enum: SEMANTIC_TRACE_OPERAND_SLOTS } },
  completeness: { enum: ['separate-extraction-analysis-response', 'source-coverage-and-truncation'] },
  feasibility: { const: 'unsupported' }, unsupported: { type: 'array', minItems: 1, uniqueItems: true, items: text }
});
SEMANTIC_PATH_DECLARATION_SCHEMA.oneOf = [
  ...SEMANTIC_TRACE_PATH_SEMANTICS.map(semantics => ({ type: 'object', properties: {
    semantics: { const: semantics }, operation: { enum: ['semantic_trace', 'semantic_explain'] },
    referenceKind: { const: 'semantic-record-ref' }, scopeIdentity: { const: 'semantic-generation-and-inventory' },
    contextPolicy: { const: semantics === 'balanced-call-value' ? 'prefix-balanced-call-site-and-context-key' : 'unrestricted-relations' },
    directions: { const: ['upstream', 'downstream'] }, edgeKindPolicy: { const: 'semantic-edge-kinds' },
    completeness: { const: 'separate-extraction-analysis-response' }
  } })),
  { type: 'object', properties: {
    semantics: { const: 'graph-witness' }, operation: { const: 'graph_context' }, referenceKind: { const: 'graph-node-ref' },
    scopeIdentity: { const: 'index-signature' }, contextPolicy: { const: 'graph-adjacency' },
    directions: { const: ['out', 'in', 'both'] }, edgeKindPolicy: { const: 'graph-relation-kinds' },
    edgeKinds: { const: [] }, operandSlots: { const: [] }, completeness: { const: 'source-coverage-and-truncation' }
  } }
];
const bounded = maximum => ({ type: 'integer', minimum: 1, maximum });
export const SEMANTIC_PATH_EXECUTION_SCHEMA = object({
  declaration: { ...SEMANTIC_PATH_DECLARATION_SCHEMA, properties: {
    ...SEMANTIC_PATH_DECLARATION_SCHEMA.properties, semantics: { enum: SEMANTIC_TRACE_PATH_SEMANTICS },
    operation: { enum: ['semantic_trace', 'semantic_explain'] }, referenceKind: { const: 'semantic-record-ref' },
    scopeIdentity: { const: 'semantic-generation-and-inventory' }, edgeKindPolicy: { const: 'semantic-edge-kinds' },
    completeness: { const: 'separate-extraction-analysis-response' }
  } },
  scope: object({ repoRoot: text, generation: SEMANTIC_GENERATION_SCHEMA, inventory: text }),
  limits: object({ records: bounded(128), edges: bounded(512), depth: bounded(64), bytes: bounded(65536), workMs: bounded(250),
    callContextDepth: { enum: [0, 16] }, visited: { const: 16384 }, partitionsPerPage: { const: 16 }, validationRecordsPerEdge: { const: 6 } }),
  selectedKinds: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: SEMANTIC_EDGE_KINDS } },
  validation: { const: 'retained-edge-and-call-context' }, execution: { const: 'none' }
});
export const SEMANTIC_PATH_FRONTIER_REASONS = Object.freeze([
  'call_context_unavailable', 'call_operand_unavailable', 'operand_validation_unavailable', 'edge_evidence_unavailable',
  'record_budget', 'edge_budget', 'partition_budget'
]);
