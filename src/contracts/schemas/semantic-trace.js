import { SEMANTIC_DETAIL_RESULT_SCHEMA } from './semantic-query.js';
import { SEMANTIC_RECORD_REF_SCHEMA, SEMANTIC_EDGE_KINDS } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text, semanticInteger as integer, semanticNullable as nullable } from './semantic-envelopes.js';
import { SEMANTIC_PATH_EXECUTION_SCHEMA, SEMANTIC_TRACE_PATH_SEMANTICS,
  SEMANTIC_TRACE_OPERAND_SLOTS, SEMANTIC_PATH_FRONTIER_REASONS } from './semantic-path.js';
const bounded = maximum => ({ type: 'integer', minimum: 1, maximum });
export const SEMANTIC_TRACE_REQUEST_SCHEMA = object({
  repoRoot: text, generation: SEMANTIC_GENERATION_SCHEMA, seed: SEMANTIC_RECORD_REF_SCHEMA,
  direction: { enum: ['upstream', 'downstream'] }
}, {
  backend: {enum:['artifact','sqlite']},
  pathSemantics: { enum: SEMANTIC_TRACE_PATH_SEMANTICS },
  slot: object({ name: { enum: SEMANTIC_TRACE_OPERAND_SLOTS }, ordinal: integer }),
  kinds: { type: 'array', uniqueItems: true, minItems: 1, items: { enum: SEMANTIC_EDGE_KINDS } },
  limits: object({}, { records: bounded(128), edges: bounded(512), depth: bounded(64), bytes: bounded(65536), workMs: bounded(250) }),
  cursor: nullable(text)
});
export const SEMANTIC_TRACE_RESULT_SCHEMA = {
  ...SEMANTIC_DETAIL_RESULT_SCHEMA,
  properties: {
    ...SEMANTIC_DETAIL_RESULT_SCHEMA.properties,
    pathCapability: SEMANTIC_PATH_EXECUTION_SCHEMA,
    frontier: { type: 'array', items: object({ reason: { enum: [
      'call_context_budget', 'record_not_found', 'response_budget', 'depth_budget', 'work_budget', 'analysis_incomplete', 'slot_unavailable', 'visited_budget',
      ...SEMANTIC_PATH_FRONTIER_REASONS
    ] } }, { ref: SEMANTIC_RECORD_REF_SCHEMA, remainingCount: integer }) }
  }
};
