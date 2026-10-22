import { SEMANTIC_RECORD_REF_SCHEMA, SEMANTIC_NODE_SCHEMA, SEMANTIC_COVERAGE_SCHEMA, SEMANTIC_EDGE_SCHEMA, SEMANTIC_OPERAND_SCHEMA, SEMANTIC_OWNERSHIP_SCHEMA } from './semantic.js';
import { SYMBOLIC_TYPE_QUERY_SCHEMA, SYMBOLIC_TYPE_QUERY_RESULT_SCHEMA } from './symbolic-types.js';
import { SEMANTIC_GENERATION_SCHEMA, SEMANTIC_SOURCE_SCHEMA, semanticObject as object, semanticText as text, semanticInteger as integer, semanticNullable as nullable } from './semantic-envelopes.js';
export const SEMANTIC_SOURCE_REFERENCES_SCHEMA = { type: 'array', maxItems: 128, items: object({
  ref: SEMANTIC_RECORD_REF_SCHEMA, sourceUnitId: SEMANTIC_SOURCE_SCHEMA.properties.sourceUnitId,
  sourceHash: SEMANTIC_SOURCE_SCHEMA.properties.byteHash, path: SEMANTIC_SOURCE_SCHEMA.properties.path,
  coordinateUnit: SEMANTIC_SOURCE_SCHEMA.properties.coordinateUnit
}) };
export const SEMANTIC_COVERAGE_PROJECTION_SCHEMA = { ...SEMANTIC_COVERAGE_SCHEMA, properties: { ...SEMANTIC_COVERAGE_SCHEMA.properties, partitionId: SEMANTIC_RECORD_REF_SCHEMA.properties.partitionId } };
const fields = { type: 'array', uniqueItems: true, items: { enum: ['span', 'scope', 'data'] } };
const bounded = (maximum) => ({ type: 'integer', minimum: 1, maximum });
const compactText = { type: 'string', maxLength: 256 };
const evidenceSpan = { type: 'array', minItems: 2, maxItems: 2, items: integer };
const evidenceSourceId = SEMANTIC_SOURCE_SCHEMA.properties.sourceUnitId;
const evidenceHash = SEMANTIC_SOURCE_SCHEMA.properties.byteHash;
const evidenceIdentity = {
  evidenceRef: SEMANTIC_RECORD_REF_SCHEMA, producerId: compactText, method: compactText, evidenceKind: compactText,
  sourceUnitId: evidenceSourceId, sourceHash: evidenceHash
};
const evidenceReason = { type: 'string', minLength: 1, maxLength: 4096 };
export const SEMANTIC_PROVIDER_EVIDENCE_SCHEMA = { oneOf: [
  object({ ...evidenceIdentity, kind: { const: 'reference' },
    qualification: { const: 'source-qualified-observation' }, state: { enum: ['partial', 'unresolved'] },
    name: compactText, family: compactText, reason: evidenceReason, span: evidenceSpan,
  target: nullable(object({ path: SEMANTIC_SOURCE_SCHEMA.properties.path,
    sourceUnitId: evidenceSourceId, sourceHash: evidenceHash, span: evidenceSpan })),
    candidateCount: { type: 'integer', minimum: 0, maximum: 4096 } }),
  object({ ...evidenceIdentity, kind: { const: 'diagnostic' },
    qualification: { const: 'source-qualified-observation' }, state: { const: 'partial' }, span: nullable(evidenceSpan),
    diagnostic: object({ code: compactText, message: { type: 'string', maxLength: 1024 },
      severity: { type: 'string', maxLength: 32 }, truncated: { type: 'boolean' } }) }),
  object({ ...evidenceIdentity, kind: { const: 'observation' },
    qualification: { const: 'provider-observation' }, state: { const: 'partial' },
    name: compactText, family: compactText, reason: evidenceReason,
    observedTarget: nullable(object({ sourceUnitId: nullable(evidenceSourceId), sourceHash: nullable(evidenceHash),
      span: nullable(evidenceSpan), state: compactText })) }),
  object({ ...evidenceIdentity, kind: { const: 'state' },
    qualification: { enum: ['source-qualified-observation', 'provider-observation'] },
    state: { const: 'partial' }, reason: evidenceReason }),
  object({ ...evidenceIdentity, sourceUnitId: nullable(evidenceSourceId), sourceHash: { type: 'null' },
    kind: { const: 'state' }, qualification: { const: 'unavailable' },
    state: { enum: ['unavailable', 'budget'] }, reason: evidenceReason })
] };
export const SEMANTIC_DETAIL_REQUEST_SCHEMA = object({
  repoRoot: text, generation: SEMANTIC_GENERATION_SCHEMA,
  refs: { type: 'array', maxItems: 16384, items: SEMANTIC_RECORD_REF_SCHEMA }
}, {
  fields, include: { type: 'array', uniqueItems: true, items: { enum: ['operands', 'names', 'ownership', 'providerEvidence'] } }, limits: object({}, { records: bounded(128), bytes: bounded(65536), workMs: bounded(250), rows: bounded(512) }),
  cursor: nullable(text), typeQueries: { type: 'array', minItems: 1, maxItems: 16, items: SYMBOLIC_TYPE_QUERY_SCHEMA }
});
const projection = { oneOf: SEMANTIC_NODE_SCHEMA.oneOf.map(({ properties }) => object({
  ref: SEMANTIC_RECORD_REF_SCHEMA, id: integer, kind: properties.kind,
  availableFieldGroups: fields, omittedFieldGroups: fields
}, { span: properties.span, scope: properties.scope, data: properties.data })) };
export const SEMANTIC_DETAIL_RESULT_SCHEMA = object({
  schemaVersion: { const: 1 }, generation: SEMANTIC_GENERATION_SCHEMA, status: { enum: ['complete', 'partial'] },
  records: { type: 'array', maxItems: 128, items: projection },
  edges: { type: 'array', maxItems: 512, items: SEMANTIC_EDGE_SCHEMA },
  operands: { type: 'array', maxItems: 512, items: SEMANTIC_OPERAND_SCHEMA },
  ownership: { type: 'array', maxItems: 512, items: SEMANTIC_OWNERSHIP_SCHEMA },
  names: { type: 'array', maxItems: 512, items: object({
    partitionId: SEMANTIC_RECORD_REF_SCHEMA.properties.partitionId, id: integer, value: { type: 'string' }
  }) },
  evidenceRefs: { type: 'array', items: SEMANTIC_RECORD_REF_SCHEMA },
  coverage: object({
    extraction: { type: 'array', items: SEMANTIC_COVERAGE_PROJECTION_SCHEMA },
    analysis: { type: 'array', items: SEMANTIC_COVERAGE_PROJECTION_SCHEMA },
    response: object({ state: { enum: ['complete', 'partial'] }, returnedCount: integer }, { hydratedCount: integer })
  }),
  frontier: { type: 'array', items: { oneOf: [
    object({ ref: SEMANTIC_RECORD_REF_SCHEMA, reason: { const: 'record_not_found' } }),
    object({ reason: { const: 'response_budget' }, remainingCount: integer })
  ] } }, cursor: nullable(text), warnings: { type: 'array', items: text }
}, { typeResults: { type: 'array', maxItems: 16, items: SYMBOLIC_TYPE_QUERY_RESULT_SCHEMA }, sourceRefs: SEMANTIC_SOURCE_REFERENCES_SCHEMA,
  providerEvidence: { type: 'array', maxItems: 512, items: SEMANTIC_PROVIDER_EVIDENCE_SCHEMA } });
