import { SEMANTIC_TRACE_REQUEST_SCHEMA, SEMANTIC_TRACE_RESULT_SCHEMA } from './semantic-trace.js';
import { semanticObject as object, semanticText as text } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref, SEMANTIC_EDGE_KINDS } from './semantic.js';
export const SEMANTIC_EXPLAIN_REQUEST_SCHEMA = {...SEMANTIC_TRACE_REQUEST_SCHEMA,properties:{...SEMANTIC_TRACE_REQUEST_SCHEMA.properties}};
export const SEMANTIC_EXPLAIN_RESULT_SCHEMA = {...SEMANTIC_TRACE_RESULT_SCHEMA,properties:{...SEMANTIC_TRACE_RESULT_SCHEMA.properties,
  explanations:{type:'array',items:object({kind:{enum:SEMANTIC_EDGE_KINDS},from:ref,to:ref,evidenceClass:{enum:['exact-static','modeled','heuristic']},
    explanation:text,limitations:{type:'array',items:text}})}}};
