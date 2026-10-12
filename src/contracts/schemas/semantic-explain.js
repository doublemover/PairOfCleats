import { SEMANTIC_TRACE_REQUEST_SCHEMA, SEMANTIC_TRACE_RESULT_SCHEMA } from './semantic-trace.js';
import { semanticObject as object, semanticText as text, semanticHashSchema as hash, SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_ENRICHMENT_REQUEST_SCHEMA } from './semantic-enrichment.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref, SEMANTIC_EDGE_KINDS } from './semantic.js';
const enrichmentRequest = action => ({ ...SEMANTIC_ENRICHMENT_REQUEST_SCHEMA,
  required: [...SEMANTIC_ENRICHMENT_REQUEST_SCHEMA.required, 'action', 'taskIds'],
  properties: { ...SEMANTIC_ENRICHMENT_REQUEST_SCHEMA.properties, action: { const: action },
    taskIds: { ...SEMANTIC_ENRICHMENT_REQUEST_SCHEMA.properties.taskIds, minItems: 1, maxItems: 1 } } });
export const SEMANTIC_EXPLAIN_REQUEST_SCHEMA = {...SEMANTIC_TRACE_REQUEST_SCHEMA,properties:{...SEMANTIC_TRACE_REQUEST_SCHEMA.properties}};
export const SEMANTIC_EXPLAIN_RESULT_SCHEMA = {...SEMANTIC_TRACE_RESULT_SCHEMA,properties:{...SEMANTIC_TRACE_RESULT_SCHEMA.properties,
  sourceRefs:{type:'array',maxItems:32,items:object({ref,sourceUnitId:{type:'string',pattern:'^su1:[a-f0-9]{64}$'},sourceHash:hash,path:text,coordinateUnit:{enum:['utf16','byte']}})},
  enrichment:object({status:{enum:['available','partial','unavailable','not-needed']},reasons:{type:'array',items:text},
    suggestions:{type:'array',maxItems:8,items:object({taskId:{type:'string',pattern:'^st1:[a-f0-9]{64}$'},generation:SEMANTIC_GENERATION_SCHEMA,
      inputHash:hash,policyHash:hash,kind:text,reason:text,sourceRefs:{type:'array',maxItems:32,items:object({sourceUnitId:{type:'string',pattern:'^su1:[a-f0-9]{64}$'},sourceHash:hash})},
      planRequest:enrichmentRequest('plan'),enqueueRequest:enrichmentRequest('enqueue')})}}),
  explanations:{type:'array',items:object({kind:{enum:SEMANTIC_EDGE_KINDS},from:ref,to:ref,evidenceClass:{enum:['exact-static','modeled','heuristic']},
    explanation:text,limitations:{type:'array',items:text}})}}};
