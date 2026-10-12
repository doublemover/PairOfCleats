import { SEMANTIC_FIND_REQUEST_SCHEMA, SEMANTIC_FIND_RESULT_SCHEMA } from './semantic-find.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA, SEMANTIC_DETAIL_RESULT_SCHEMA } from './semantic-query.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA, SEMANTIC_TRACE_RESULT_SCHEMA } from './semantic-trace.js';
import { SEMANTIC_RECORD_REF_SCHEMA } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text, semanticNullable as nullable } from './semantic-envelopes.js';
const request = (operation, schema) => object({ operation: { const: operation }, request: schema });
export const SEMANTIC_CONTEXT_SCHEMA = object({
  schemaVersion: { const: 1 }, repoRoot: text, generation: nullable(SEMANTIC_GENERATION_SCHEMA),
  status: { enum: ['partial', 'unavailable'] }, selector: nullable(SEMANTIC_FIND_REQUEST_SCHEMA.properties.selector),
  discovery: nullable(SEMANTIC_FIND_RESULT_SCHEMA), detail: nullable(SEMANTIC_DETAIL_RESULT_SCHEMA), trace: nullable(SEMANTIC_TRACE_RESULT_SCHEMA),
  excerpts: { type: 'array', maxItems: 1, items: object({ ref: SEMANTIC_RECORD_REF_SCHEMA, sourceUnitId: text, sourceHash: text,
    coordinateUnit: { const: 'utf16' }, span: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 }, text: { type: 'string' } }) },
  followUps: { type: 'array', maxItems: 3, items: { oneOf: [request('semantic_find', SEMANTIC_FIND_REQUEST_SCHEMA), request('semantic_detail', SEMANTIC_DETAIL_REQUEST_SCHEMA), request('semantic_trace', SEMANTIC_TRACE_REQUEST_SCHEMA)] } },
  warnings: { type: 'array', items: text }
});
export const SEMANTIC_CONTEXT_FEDERATION_SCHEMA = object({ scope: { const: 'per-repository' },
  repositories: { type: 'array', maxItems: 16, items: object({ repoId: text, section: SEMANTIC_CONTEXT_SCHEMA }) } });
