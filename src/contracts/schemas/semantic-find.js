import { OPERATION_SELECTOR_FIELDS } from '../../semantic/operation-index.js';
import { SEMANTIC_DETAIL_RESULT_SCHEMA } from './semantic-query.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text, semanticNullable as nullable } from './semantic-envelopes.js';
const bounded = maximum => ({type:'integer',minimum:1,maximum});
const roles = { enum: ['local', 'parameter', 'field', 'return'] };
const scalar = object({ type: { enum: ['boolean', 'null', 'number', 'string', 'bigint'] },
  representation: { type: 'string', maxLength: 65536 } });
const typeSelector = object({ expression: { type: 'string', minLength: 1, maxLength: 65536 },
  match: { const: 'exact-expression' },
  sources: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['compiler', 'declared'] } },
  roles: { type: 'array', minItems: 1, uniqueItems: true, items: roles } });
export const SEMANTIC_FIND_REQUEST_SCHEMA = object({repoRoot:text,generation:SEMANTIC_GENERATION_SCHEMA,
  selector:{oneOf:[object({field:{enum:OPERATION_SELECTOR_FIELDS},value:{type:'string',minLength:1,maxLength:4096}}, {range:object({start:{type:'integer',minimum:0},end:{type:'integer',minimum:1}})}),object({target:ref}),
    object({typeExpression:typeSelector}), object({literal:scalar})]}}, {
  backend:{enum:['artifact','sqlite']},compareTo:ref,limits:object({}, {records:bounded(128),bytes:bounded(65536),workMs:bounded(250)}),cursor:nullable(text)});
export const SEMANTIC_FIND_RESULT_SCHEMA = {...SEMANTIC_DETAIL_RESULT_SCHEMA, properties:{...SEMANTIC_DETAIL_RESULT_SCHEMA.properties,
  matches:{type:'array',items:object({ref,category:{enum:['structural-candidate','target-candidate','source-candidate','ownership-candidate','type-fact','literal-value']},scoreMeaning:text,differences:{type:'array',items:text}},
    {fact:object({kind:{enum:['type','literal']},source:{enum:['compiler','declared','literal']},role:nullable(roles),owner:nullable(ref),
      sourceUnitId:text,sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},expression:nullable(text),scalar:nullable(scalar),compilerContextKey:nullable(text)}),
    fingerprint:object({projectionVersion:{const:2},hash:nullable(text),complete:{type:'boolean'},reasons:{type:'array',items:text},constraints:{type:'array',items:text},visited:{type:'integer',minimum:0}})})}}};
