import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_EXPLAIN_REQUEST_SCHEMA, SEMANTIC_EXPLAIN_RESULT_SCHEMA } from '../schemas/semantic-explain.js';
import { assertSemanticTraceProjection } from './semantic-trace.js';
const ajv=createAjv({allErrors:true,strict:true});
const validators={request:compileSchema(ajv,SEMANTIC_EXPLAIN_REQUEST_SCHEMA),result:compileSchema(ajv,SEMANTIC_EXPLAIN_RESULT_SCHEMA)};
export const assertSemanticExplain=(kind,value)=>{const validate=validators[kind];if(!validate||!validate(value))throw Object.assign(new TypeError('Invalid semantic explanation '+kind+': '+ajv.errorsText(validate?.errors)),kind==='request'?{code:'ERR_SEMANTIC_QUERY_CONTRACT'}:{});if(kind==='result')assertSemanticTraceProjection(value,'semantic_explain');return value;};
