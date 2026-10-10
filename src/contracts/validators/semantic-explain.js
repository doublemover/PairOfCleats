import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_EXPLAIN_REQUEST_SCHEMA, SEMANTIC_EXPLAIN_RESULT_SCHEMA } from '../schemas/semantic-explain.js';
const ajv=createAjv({allErrors:true,strict:true});
const validators={request:compileSchema(ajv,SEMANTIC_EXPLAIN_REQUEST_SCHEMA),result:compileSchema(ajv,SEMANTIC_EXPLAIN_RESULT_SCHEMA)};
export const assertSemanticExplain=(kind,value)=>{const validate=validators[kind];if(!validate||!validate(value))throw new TypeError('Invalid semantic explanation '+kind+': '+ajv.errorsText(validate?.errors));return value;};
