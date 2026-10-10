import { SEMANTIC_RECORD_REF_SCHEMA, SEMANTIC_NODE_SCHEMA, SEMANTIC_COVERAGE_SCHEMA, SEMANTIC_EDGE_SCHEMA } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text, semanticInteger as integer, semanticNullable as nullable } from './semantic-envelopes.js';
const fields = { type: 'array', uniqueItems: true, items: { enum: ['span', 'scope', 'data'] } };
const bounded = (maximum) => ({ type: 'integer', minimum: 1, maximum });
export const SEMANTIC_DETAIL_REQUEST_SCHEMA = object({
  repoRoot: text, generation: SEMANTIC_GENERATION_SCHEMA,
  refs: { type: 'array', maxItems: 16384, items: SEMANTIC_RECORD_REF_SCHEMA }
}, {
  fields, limits: object({}, { records: bounded(128), bytes: bounded(65536), workMs: bounded(250) }),
  cursor: nullable(text)
});
const projection = { oneOf: SEMANTIC_NODE_SCHEMA.oneOf.map(({ properties }) => object({
  ref: SEMANTIC_RECORD_REF_SCHEMA, id: integer, kind: properties.kind,
  availableFieldGroups: fields, omittedFieldGroups: fields
}, { span: properties.span, scope: properties.scope, data: properties.data })) };
export const SEMANTIC_DETAIL_RESULT_SCHEMA = object({
  schemaVersion: { const: 1 }, generation: SEMANTIC_GENERATION_SCHEMA, status: { enum: ['complete', 'partial'] },
  records: { type: 'array', maxItems: 128, items: projection },
  edges: { type: 'array', maxItems: 512, items: SEMANTIC_EDGE_SCHEMA },
  evidenceRefs: { type: 'array', items: SEMANTIC_RECORD_REF_SCHEMA },
  coverage: object({
    extraction: { type: 'array', items: SEMANTIC_COVERAGE_SCHEMA },
    analysis: { type: 'array', items: SEMANTIC_COVERAGE_SCHEMA },
    response: object({ state: { enum: ['complete', 'partial'] }, returnedCount: integer })
  }),
  frontier: { type: 'array', items: { oneOf: [
    object({ ref: SEMANTIC_RECORD_REF_SCHEMA, reason: { const: 'record_not_found' } }),
    object({ reason: { const: 'response_budget' }, remainingCount: integer })
  ] } }, cursor: nullable(text), warnings: { type: 'array', items: text }
});
