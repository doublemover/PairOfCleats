import { SEMANTIC_DETAIL_RESULT_SCHEMA } from './semantic-query.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object, semanticText as text, semanticNullable as nullable } from './semantic-envelopes.js';
const bounded = maximum => ({type:'integer',minimum:1,maximum});
export const SEMANTIC_FIND_REQUEST_SCHEMA = object({repoRoot:text,generation:SEMANTIC_GENERATION_SCHEMA,
  selector:{oneOf:[object({field:{enum:['astKind','operation','invocationKind']},value:{type:'string',minLength:1,maxLength:256}}),object({target:ref})]}}, {
  backend:{enum:['artifact','sqlite']},compareTo:ref,limits:object({}, {records:bounded(128),bytes:bounded(65536),workMs:bounded(250)}),cursor:nullable(text)});
export const SEMANTIC_FIND_RESULT_SCHEMA = {...SEMANTIC_DETAIL_RESULT_SCHEMA, properties:{...SEMANTIC_DETAIL_RESULT_SCHEMA.properties,
  matches:{type:'array',items:object({ref,category:{enum:['structural-candidate','target-candidate']},scoreMeaning:text,differences:{type:'array',items:text}},
    {fingerprint:object({projectionVersion:{const:1},hash:nullable(text),complete:{type:'boolean'},reasons:{type:'array',items:text},constraints:{type:'array',items:text},visited:{type:'integer',minimum:0}})})}}};
